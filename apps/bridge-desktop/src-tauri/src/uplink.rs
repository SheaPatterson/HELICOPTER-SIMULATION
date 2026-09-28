//! TLS transmission-eligibility decision contract for the cloud uplink
//! (requirements 8.8, 8.8a; design Section 9.1 and the "TLS below 1.2
//! negotiated" error-handling row).
//!
//! ## Why this module exists (and what it is NOT)
//!
//! The real TLS uplink client — the thing that opens a socket, performs the TLS
//! handshake, and streams telemetry frames to the cloud — is **task 5.6** and
//! is not implemented yet. This module ships the small, pure **decision seam**
//! that the client's abort logic is built on, so the security-critical rule can
//! be specified and unit-tested (this task, 5.7) independently of any real I/O.
//!
//! The rule, verbatim from the requirements:
//!
//! * **8.8** — When the Bridge transmits telemetry it SHALL encrypt with TLS
//!   1.2 or higher, and SHALL **abort the transmission without sending
//!   telemetry if a TLS session cannot be established**.
//! * **8.8a** — If a session *is* established but negotiates a version **below
//!   1.2**, the Bridge SHALL treat it as equivalent to a session that cannot be
//!   established: abort, and send **no telemetry** over that session.
//!
//! [`tls_transmission_permitted`] encodes exactly that rule as a total function
//! over the possible handshake outcomes ([`TlsNegotiation`]). It has no
//! dependencies, no I/O, and no state, so it is trivially testable and cannot
//! "accidentally" transmit.
//!
//! ## How task 5.6 adopts this without rework
//!
//! The TLS client (5.6) performs the handshake, maps the concrete negotiated
//! protocol version onto a [`TlsNegotiation`], and calls
//! [`tls_transmission_permitted`] **before writing any telemetry bytes**:
//!
//! ```ignore
//! // Inside the real task-5.6 client, after the handshake:
//! let negotiation = match handshake_result {
//!     Ok(session) => TlsNegotiation::Established(session.protocol_version()),
//!     Err(_)      => TlsNegotiation::NotEstablished,
//! };
//! tls_transmission_permitted(negotiation)?; // aborts before any send on failure
//! // ...only now is it sound to write frames to the socket...
//! ```
//!
//! Because the decision is a pure function returning `Result<(), TlsAbortReason>`,
//! the client's happy path is "check, then send" and every abort path is
//! "return the reason, send nothing" — there is no code path that both aborts
//! and transmits. Keeping the rule here (rather than inline in 5.6) also lets
//! this contract be reused by any future transport (WebSocket vs HTTPS, design
//! Section "TLS WebSocket / HTTPS").
//!
//! ## The client (task 5.6)
//!
//! The concrete TLS uplink client that adopts this contract lives in the
//! [`client`] submodule: [`client::TlsUplink`] performs the handshake, maps the
//! negotiated version onto [`TlsNegotiation`], calls [`tls_transmission_permitted`]
//! before writing any bytes, and resolves the API key from a
//! [`crate::runtime::SecretReference`] at runtime so no secret is bundled
//! (requirement 8.12).

pub mod client;

/// A negotiated TLS protocol version, coarse-grained to exactly the boundary
/// the requirement cares about.
///
/// The bridge does not need the full version matrix to make the abort decision
/// — it only needs to know whether the negotiated version is at least TLS 1.2.
/// Task 5.6 maps its transport's concrete version enum onto this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TlsVersion {
    /// TLS 1.0 — below the 1.2 floor (requirement 8.8a: abort).
    Tls1_0,
    /// TLS 1.1 — below the 1.2 floor (requirement 8.8a: abort).
    Tls1_1,
    /// TLS 1.2 — the minimum acceptable version (requirement 8.8).
    Tls1_2,
    /// TLS 1.3 — acceptable (requirement 8.8).
    Tls1_3,
}

impl TlsVersion {
    /// The minimum TLS version the bridge will transmit over (requirement 8.8:
    /// "TLS version 1.2 or higher").
    pub const MINIMUM: TlsVersion = TlsVersion::Tls1_2;

    /// Whether this negotiated version satisfies the 1.2-or-higher floor.
    ///
    /// Relies on the `PartialOrd`/`Ord` derive: the variants are declared in
    /// ascending protocol order, so `>= MINIMUM` is the "1.2 or higher" test.
    #[must_use]
    pub fn meets_minimum(self) -> bool {
        self >= TlsVersion::MINIMUM
    }
}

/// The outcome of attempting the TLS handshake, as seen by the abort decision.
///
/// Task 5.6's real client produces one of these after its handshake attempt;
/// this task's tests construct them directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsNegotiation {
    /// A TLS session was established and negotiated the given protocol version.
    Established(TlsVersion),
    /// No TLS session could be established at all (handshake failed, connection
    /// refused, certificate rejected, timeout, ...). Requirement 8.8: abort.
    NotEstablished,
}

/// Why a transmission was aborted before any telemetry was sent. Returned as
/// the `Err` of [`tls_transmission_permitted`]; carries enough detail for the
/// runtime/UI to surface an actionable message and for an audit diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsAbortReason {
    /// Requirement 8.8: a TLS session could not be established. No telemetry is
    /// sent.
    SessionNotEstablished,
    /// Requirement 8.8a: a session was established but negotiated a version
    /// below the 1.2 floor. Treated as equivalent to "cannot be established":
    /// the negotiated (too-low) version is carried for diagnostics. No
    /// telemetry is sent over that session.
    VersionBelowMinimum {
        /// The insufficient version that was negotiated.
        negotiated: TlsVersion,
        /// The minimum the bridge requires ([`TlsVersion::MINIMUM`]).
        required: TlsVersion,
    },
}

impl core::fmt::Display for TlsAbortReason {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            TlsAbortReason::SessionNotEstablished => write!(
                f,
                "TLS session could not be established; aborting transmission and \
                 sending no telemetry"
            ),
            TlsAbortReason::VersionBelowMinimum {
                negotiated,
                required,
            } => write!(
                f,
                "negotiated TLS version {negotiated:?} is below the required \
                 minimum {required:?}; treating as not established, aborting \
                 transmission and sending no telemetry"
            ),
        }
    }
}

impl std::error::Error for TlsAbortReason {}

/// The single security-critical decision: may telemetry be transmitted over
/// this TLS negotiation outcome? (requirements 8.8 and 8.8a).
///
/// * `Ok(())` — the session is established **and** negotiated TLS 1.2 or higher;
///   the caller (task 5.6) may proceed to send telemetry.
/// * `Err(TlsAbortReason::SessionNotEstablished)` — no session; **abort, send
///   nothing** (8.8).
/// * `Err(TlsAbortReason::VersionBelowMinimum { .. })` — session negotiated
///   below 1.2; treated as if it could not be established: **abort, send
///   nothing** (8.8a).
///
/// This is a *total* function: every possible [`TlsNegotiation`] maps to a
/// definite permit-or-abort decision, so no handshake outcome can slip through
/// unchecked.
pub fn tls_transmission_permitted(negotiation: TlsNegotiation) -> Result<(), TlsAbortReason> {
    match negotiation {
        TlsNegotiation::NotEstablished => Err(TlsAbortReason::SessionNotEstablished),
        TlsNegotiation::Established(version) if version.meets_minimum() => Ok(()),
        TlsNegotiation::Established(version) => Err(TlsAbortReason::VersionBelowMinimum {
            negotiated: version,
            required: TlsVersion::MINIMUM,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- requirement 8.8: session cannot be established -> abort, no send ---

    #[test]
    fn aborts_when_no_session_established() {
        let decision = tls_transmission_permitted(TlsNegotiation::NotEstablished);
        assert_eq!(decision, Err(TlsAbortReason::SessionNotEstablished));
        // The Err return is the signal to send nothing: there is no Ok path here,
        // so a caller that only transmits on Ok(()) sends no telemetry.
        assert!(decision.is_err(), "no session must abort transmission");
    }

    // ---- requirement 8.8a: negotiated below 1.2 -> treat as not established --

    #[test]
    fn aborts_when_negotiated_below_minimum() {
        for below in [TlsVersion::Tls1_0, TlsVersion::Tls1_1] {
            let decision =
                tls_transmission_permitted(TlsNegotiation::Established(below));
            assert_eq!(
                decision,
                Err(TlsAbortReason::VersionBelowMinimum {
                    negotiated: below,
                    required: TlsVersion::Tls1_2,
                }),
                "TLS {below:?} is below the 1.2 floor and must abort (8.8a)"
            );
            assert!(
                decision.is_err(),
                "a sub-1.2 session must send no telemetry (8.8a)"
            );
        }
    }

    #[test]
    fn sub_minimum_is_treated_equivalently_to_no_session() {
        // 8.8a: a sub-1.2 negotiation is "equivalent to a session that cannot be
        // established" — both outcomes abort and send nothing. We assert the
        // shared observable property (Err => no transmission) rather than
        // conflating the two distinct, diagnosable reasons.
        let no_session = tls_transmission_permitted(TlsNegotiation::NotEstablished);
        let too_low =
            tls_transmission_permitted(TlsNegotiation::Established(TlsVersion::Tls1_1));
        assert!(no_session.is_err() && too_low.is_err());
    }

    // ---- requirement 8.8: negotiated 1.2 or higher -> permitted --------------

    #[test]
    fn permits_when_negotiated_at_or_above_minimum() {
        for ok in [TlsVersion::Tls1_2, TlsVersion::Tls1_3] {
            assert_eq!(
                tls_transmission_permitted(TlsNegotiation::Established(ok)),
                Ok(()),
                "TLS {ok:?} meets the 1.2-or-higher requirement (8.8)"
            );
        }
    }

    #[test]
    fn minimum_boundary_is_inclusive() {
        // The floor is "1.2 or higher": exactly 1.2 is permitted (boundary), and
        // the ordering that drives the check is ascending.
        assert!(TlsVersion::Tls1_2.meets_minimum());
        assert!(TlsVersion::Tls1_3.meets_minimum());
        assert!(!TlsVersion::Tls1_1.meets_minimum());
        assert!(!TlsVersion::Tls1_0.meets_minimum());
        assert!(TlsVersion::Tls1_0 < TlsVersion::Tls1_2);
        assert!(TlsVersion::Tls1_3 > TlsVersion::Tls1_2);
    }

    #[test]
    fn abort_reasons_render_a_no_telemetry_message() {
        // The abort reason must communicate that nothing was sent, so the
        // runtime/UI and any audit diagnostic can surface it (design "TLS below
        // 1.2 negotiated" handling).
        assert!(TlsAbortReason::SessionNotEstablished
            .to_string()
            .contains("no telemetry"));
        assert!(TlsAbortReason::VersionBelowMinimum {
            negotiated: TlsVersion::Tls1_0,
            required: TlsVersion::Tls1_2,
        }
        .to_string()
        .contains("no telemetry"));
    }
}
