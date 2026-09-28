//! The TLS uplink client (task 5.6): opens a TLS 1.2+ session to the cloud
//! ingestion endpoint and streams telemetry frames over it, aborting — sending
//! **no telemetry** — whenever a session cannot be established or negotiates
//! below TLS 1.2 (requirements 8.8, 8.8a), and resolving the API key from a
//! secure reference at runtime so **no secret is ever embedded in the bridge
//! package** (requirement 8.12).
//!
//! ## How this satisfies the requirements
//!
//! * **8.8 — encrypt with TLS 1.2+, abort if no session.** The rustls
//!   [`ClientConfig`](rustls::ClientConfig) is built with its protocol range
//!   restricted to TLS 1.2 and TLS 1.3 (the `tls12` feature plus the default
//!   1.3 support), so the transport itself refuses anything older. If the
//!   handshake cannot complete at all the transport reports
//!   [`TlsNegotiation::NotEstablished`], which
//!   [`tls_transmission_permitted`](crate::uplink::tls_transmission_permitted)
//!   turns into an abort **before any byte of telemetry is written**.
//! * **8.8a — sub-1.2 negotiation ≡ no session.** After the handshake the
//!   negotiated protocol version is mapped onto [`TlsVersion`] and fed through
//!   the same decision function; a version below 1.2 aborts identically. (In
//!   practice rustls will not negotiate < 1.2 given our config, but the client
//!   re-checks the *observed* version so the security rule holds even if the
//!   transport were reconfigured — defense in depth around the pure contract.)
//! * **8.12 — no service-role secret in the package.** The client never stores
//!   secret material. It holds only a [`SecretReference`] (a key *name*) and an
//!   injectable [`SecretResolver`] that fetches the value at runtime from an OS
//!   keychain or environment variable. The compiled binary contains the
//!   *reference*, never the key.
//!
//! ## Testability seam
//!
//! Real network + TLS I/O cannot run in CI here, so — exactly like the X-Plane
//! adapter injects a `DatagramSource` and the MSFS adapter injects its source —
//! this client is generic over a [`TlsTransport`] seam. The seam performs the
//! handshake (returning a [`TlsNegotiation`]) and, only if permitted, sends the
//! serialized frame. The version-decision and abort logic — the
//! security-critical part — is therefore unit-testable with a scripted
//! transport and reuses [`tls_transmission_permitted`] verbatim. The production
//! transport ([`RustlsTransport`]) is the thin adapter over `rustls` driven on
//! a blocking `TcpStream`.

use crate::runtime::{PublishOutcome, SecretReference, Uplink};
use crate::telemetry::TelemetryFrame;
use crate::uplink::{tls_transmission_permitted, TlsAbortReason, TlsNegotiation, TlsVersion};

/// Resolves a [`SecretReference`] to the actual API key **at runtime**, so the
/// secret is never compiled into or bundled with the bridge (requirement 8.12).
///
/// Implementors read from an OS keychain, an environment variable, or another
/// runtime secret store. The bridge package ships only the *reference*; the
/// value is fetched on first use and kept in process memory, never persisted by
/// this client.
pub trait SecretResolver {
    /// Fetch the secret value named by `reference`, or a diagnostic describing
    /// why it could not be resolved (missing entry, locked keychain, ...).
    fn resolve(&self, reference: &SecretReference) -> Result<String, String>;
}

/// The default runtime resolver: reads the secret from the process environment
/// under the variable named by [`SecretReference::key`]. This keeps the value
/// out of the binary and out of source (requirement 8.12) — the operator
/// provisions the environment (or an OS keychain-backed launcher does) at run
/// time.
#[derive(Debug, Clone, Copy, Default)]
pub struct EnvSecretResolver;

impl SecretResolver for EnvSecretResolver {
    fn resolve(&self, reference: &SecretReference) -> Result<String, String> {
        std::env::var(&reference.key).map_err(|_| {
            format!(
                "API key reference {:?} is not present in the runtime environment; \
                 the bridge package intentionally contains no secret value",
                reference.key
            )
        })
    }
}

/// The transport seam: performs the TLS handshake to the endpoint and, only
/// when the negotiation is acceptable, transmits one serialized frame.
///
/// Split into two calls so the security decision sits *between* them and no
/// implementation can transmit without a prior successful handshake:
/// 1. [`TlsTransport::handshake`] opens the session and reports what was
///    negotiated ([`TlsNegotiation`]) — but sends nothing.
/// 2. [`TlsTransport::send_frame`] is invoked by [`TlsUplink`] **only after**
///    [`tls_transmission_permitted`] returns `Ok` for that negotiation.
///
/// The production [`RustlsTransport`] implements this over `rustls` on a
/// blocking `TcpStream`; tests implement it with a scripted transport to
/// exercise every abort path without real I/O.
pub trait TlsTransport {
    /// Attempt to establish the TLS session to `endpoint`. Returns the observed
    /// negotiation outcome. MUST NOT transmit any telemetry.
    fn handshake(&mut self, endpoint: &str) -> TlsNegotiation;

    /// Transmit one already-serialized, already-authorized frame body over the
    /// established session, using `api_key` for authorization. Called by
    /// [`TlsUplink`] only after the negotiation was permitted. Returns a
    /// [`PublishOutcome`] classifying the send result (design Section 6.2).
    fn send_frame(&mut self, endpoint: &str, api_key: &str, body: &[u8]) -> PublishOutcome;
}

/// A telemetry uplink that encrypts with TLS 1.2+ and aborts (sending nothing)
/// on any session that cannot be established or negotiates below 1.2
/// (requirements 8.8/8.8a), authorized by a runtime-resolved API key
/// (requirement 8.12).
///
/// Generic over the [`TlsTransport`] and [`SecretResolver`] seams so the abort
/// and secret-resolution logic is unit-testable without real network, TLS, or
/// keychain access. Implements the runtime's [`Uplink`] trait so the
/// [`crate::runtime::BridgeRuntime`] can drive it in place of the
/// [`crate::runtime::NoopUplink`].
pub struct TlsUplink<T: TlsTransport, R: SecretResolver = EnvSecretResolver> {
    endpoint: String,
    api_key_reference: SecretReference,
    transport: T,
    resolver: R,
    /// The last abort/failure diagnostic, exposed for the runtime/UI and audit
    /// (design "TLS below 1.2 negotiated" handling). Never contains secret
    /// material.
    last_diagnostic: Option<String>,
}

impl<T: TlsTransport> TlsUplink<T, EnvSecretResolver> {
    /// Construct a client that resolves its API key from the environment at
    /// runtime (requirement 8.12). `endpoint` is the configured
    /// `uplink_endpoint`; `api_key_reference` is the *reference* from
    /// [`crate::runtime::BridgeConfiguration`], never the key itself.
    pub fn new(
        endpoint: impl Into<String>,
        api_key_reference: SecretReference,
        transport: T,
    ) -> Self {
        Self::with_resolver(endpoint, api_key_reference, transport, EnvSecretResolver)
    }
}

impl<T: TlsTransport, R: SecretResolver> TlsUplink<T, R> {
    /// Construct a client with an explicit [`SecretResolver`] (e.g. an OS
    /// keychain resolver in production, or a scripted resolver in tests).
    pub fn with_resolver(
        endpoint: impl Into<String>,
        api_key_reference: SecretReference,
        transport: T,
        resolver: R,
    ) -> Self {
        Self {
            endpoint: endpoint.into(),
            api_key_reference,
            transport,
            resolver,
            last_diagnostic: None,
        }
    }

    /// The most recent abort/failure diagnostic, if any. Safe to log/surface:
    /// it never carries secret material (requirement 8.12).
    #[must_use]
    pub fn last_diagnostic(&self) -> Option<&str> {
        self.last_diagnostic.as_deref()
    }

    /// The security-critical publish core, factored out so it is exercised by
    /// both [`Uplink::publish`] and the tests. The ordering is invariant:
    ///
    /// 1. **Handshake** (no telemetry sent yet).
    /// 2. **Decide** via [`tls_transmission_permitted`] — on `Err`, record the
    ///    diagnostic and return **without ever calling `send_frame`** (8.8/8.8a).
    /// 3. **Resolve** the API key at runtime — on failure, abort before sending
    ///    (a frame is never sent unauthenticated).
    /// 4. **Serialize** the frame.
    /// 5. **Send** — the only path that transmits, reached solely after a
    ///    permitted negotiation.
    fn publish_frame(&mut self, frame: &TelemetryFrame) -> PublishOutcome {
        // 1. Handshake — establishes the session but transmits nothing.
        let negotiation = self.transport.handshake(&self.endpoint);

        // 2. The single abort decision (8.8/8.8a). On any Err we send nothing.
        if let Err(reason) = tls_transmission_permitted(negotiation) {
            let diagnostic = reason.to_string();
            self.last_diagnostic = Some(diagnostic.clone());
            return match reason {
                // 8.8: no session at all -> the uplink is effectively offline;
                // the runtime leaves the frame queued for replay.
                TlsAbortReason::SessionNotEstablished => PublishOutcome::Offline,
                // 8.8a: a session existed but negotiated below 1.2. This is a
                // misconfiguration/security condition, not transient noise:
                // classify it as Retryable so the frame stays queued (never
                // discarded) while the diagnostic surfaces the downgrade — but
                // crucially NO telemetry was sent.
                TlsAbortReason::VersionBelowMinimum { .. } => PublishOutcome::Retryable(diagnostic),
            };
        }

        // 3. Resolve the API key at runtime (8.12). Never sent unauthenticated.
        let api_key = match self.resolver.resolve(&self.api_key_reference) {
            Ok(key) => key,
            Err(err) => {
                let diagnostic = format!("could not resolve API key reference: {err}");
                self.last_diagnostic = Some(diagnostic.clone());
                // Nothing was transmitted; keep the frame queued for retry once
                // the secret becomes resolvable.
                return PublishOutcome::Retryable(diagnostic);
            }
        };

        // 4. Serialize the frame body.
        let body = match serde_json::to_vec(frame) {
            Ok(bytes) => bytes,
            Err(err) => {
                // A serialization failure is not recoverable by retrying the
                // same frame; classify as permanent so it is retained as a
                // diagnostic rather than looping (requirement 2.6).
                let diagnostic = format!("failed to serialize telemetry frame: {err}");
                self.last_diagnostic = Some(diagnostic.clone());
                return PublishOutcome::Permanent(diagnostic);
            }
        };

        // 5. Transmit — reached only after a permitted TLS 1.2+ negotiation.
        let outcome = self.transport.send_frame(&self.endpoint, &api_key, &body);
        if let PublishOutcome::Retryable(msg) | PublishOutcome::Permanent(msg) = &outcome {
            self.last_diagnostic = Some(msg.clone());
        } else {
            self.last_diagnostic = None;
        }
        outcome
    }
}

impl<T: TlsTransport, R: SecretResolver> Uplink for TlsUplink<T, R> {
    fn is_available(&self) -> bool {
        // Availability is proven by a permitting handshake at publish time;
        // without probing we optimistically report available and let
        // `publish` perform the authoritative handshake + abort decision. A
        // failed/sub-1.2 handshake is reported through the PublishOutcome, so
        // no telemetry is ever sent on an unavailable or downgraded session.
        true
    }

    fn publish(&mut self, frame: &TelemetryFrame) -> PublishOutcome {
        self.publish_frame(frame)
    }
}

// ---------------------------------------------------------------------------
// Production transport: rustls over a blocking TcpStream, restricted to TLS 1.2+
// ---------------------------------------------------------------------------

/// The production [`TlsTransport`] backed by `rustls` driven directly over a
/// blocking std [`TcpStream`](std::net::TcpStream). The rustls
/// [`ClientConfig`](rustls::ClientConfig) is built with
/// `builder_with_protocol_versions(&[TLS13, TLS12])`, so the transport accepts
/// **only** TLS 1.2 and 1.3 (requirement 8.8); rustls, being pure Rust, keeps
/// the bundled build portable across Windows and macOS without
/// OpenSSL/native-tls (design Section 2.9).
///
/// After the handshake it reads the *negotiated* version via
/// [`protocol_version`](rustls::CommonState::protocol_version) and maps it onto
/// [`TlsVersion`], so [`TlsUplink`] can re-apply the 8.8a "sub-1.2 ≡ not
/// established" rule against what was actually negotiated — defense in depth
/// around the transport-level restriction.
///
/// This is a thin I/O adapter: all the security *decisions* live in
/// [`TlsUplink`] + [`tls_transmission_permitted`]. It is excluded from the unit
/// tests (which drive the seam with a scripted transport) because it performs
/// real network + TLS I/O.
pub struct RustlsTransport {
    config: std::sync::Arc<rustls::ClientConfig>,
    /// The TLS session opened by the most recent [`Self::handshake`], held open
    /// so the subsequent authorized [`Self::send_frame`] reuses the *same*
    /// negotiated session rather than opening a fresh one.
    session: Option<rustls::StreamOwned<rustls::ClientConnection, std::net::TcpStream>>,
}

impl RustlsTransport {
    /// Build a transport whose TLS stack accepts **only** TLS 1.2 and TLS 1.3
    /// (requirement 8.8), trusting the portable webpki root set so no platform
    /// cert store is required. Constructing the rustls config with exactly
    /// `[&TLS13, &TLS12]` is what makes the transport refuse to negotiate any
    /// version below 1.2 at the protocol level; [`TlsUplink`] re-checks the
    /// observed version as defense in depth (8.8a).
    #[must_use]
    pub fn new() -> Self {
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        // Restrict the protocol range to 1.2+ (requirement 8.8). rustls only
        // implements 1.2 and 1.3, so pinning both versions here excludes 1.0/1.1
        // at the transport level.
        let config = rustls::ClientConfig::builder_with_protocol_versions(&[
            &rustls::version::TLS13,
            &rustls::version::TLS12,
        ])
        .with_root_certificates(root_store)
        .with_no_client_auth();

        Self {
            config: std::sync::Arc::new(config),
            session: None,
        }
    }

    /// Map rustls' negotiated [`ProtocolVersion`](rustls::ProtocolVersion) onto
    /// the coarse [`TlsVersion`] the abort decision uses (8.8a). Anything that
    /// is not positively TLS 1.2 or 1.3 maps to `Tls1_0` so the decision treats
    /// it as below the floor (defense in depth).
    fn map_protocol_version(version: rustls::ProtocolVersion) -> TlsVersion {
        match version {
            rustls::ProtocolVersion::TLSv1_3 => TlsVersion::Tls1_3,
            rustls::ProtocolVersion::TLSv1_2 => TlsVersion::Tls1_2,
            rustls::ProtocolVersion::TLSv1_1 => TlsVersion::Tls1_1,
            _ => TlsVersion::Tls1_0,
        }
    }

    /// Split an `https://host[:port]/path` endpoint into `(host, port, path)`,
    /// defaulting to port 443 and `/` when absent. Returns `None` when the
    /// endpoint is not a parseable `https` URL (which the caller treats as
    /// "no session establishable").
    fn split_endpoint(endpoint: &str) -> Option<(String, u16, String)> {
        let rest = endpoint.strip_prefix("https://")?;
        let (authority, path) = match rest.find('/') {
            Some(idx) => (&rest[..idx], &rest[idx..]),
            None => (rest, "/"),
        };
        if authority.is_empty() {
            return None;
        }
        let (host, port) = match authority.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().ok()?),
            None => (authority.to_string(), 443u16),
        };
        Some((host, port, path.to_string()))
    }
}

impl Default for RustlsTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl TlsTransport for RustlsTransport {
    fn handshake(&mut self, endpoint: &str) -> TlsNegotiation {
        use std::net::TcpStream;

        // Drop any prior session before opening a new one.
        self.session = None;

        let Some((host, port, _path)) = Self::split_endpoint(endpoint) else {
            return TlsNegotiation::NotEstablished;
        };

        // rustls-pki-types ServerName for SNI + certificate validation.
        let Ok(server_name) =
            rustls_pki_types::ServerName::try_from(host.clone()) else {
            return TlsNegotiation::NotEstablished;
        };

        let Ok(mut connection) =
            rustls::ClientConnection::new(self.config.clone(), server_name) else {
            return TlsNegotiation::NotEstablished;
        };

        let Ok(mut tcp) = TcpStream::connect((host.as_str(), port)) else {
            // Connection refused / DNS failure / timeout: no session (8.8).
            return TlsNegotiation::NotEstablished;
        };

        // Drive the TLS handshake to completion explicitly. rustls is lazy, so
        // `complete_io` is what actually performs the negotiation; a handshake
        // failure (cert rejected, protocol mismatch, peer offering only <1.2)
        // surfaces here and means no usable session (8.8).
        if connection.complete_io(&mut tcp).is_err() {
            return TlsNegotiation::NotEstablished;
        }

        // Read the *negotiated* version and map it. `None` means no version was
        // agreed -> treat as not established (8.8/8.8a).
        let negotiation = match connection.protocol_version() {
            Some(v) => TlsNegotiation::Established(Self::map_protocol_version(v)),
            None => TlsNegotiation::NotEstablished,
        };

        // Retain the established session for the authorized send that follows a
        // permitted decision; on any abort the caller never calls send_frame,
        // and this session is dropped (and closed) on the next handshake.
        self.session = Some(rustls::StreamOwned::new(connection, tcp));
        negotiation
    }

    fn send_frame(&mut self, endpoint: &str, api_key: &str, body: &[u8]) -> PublishOutcome {
        use std::io::{Read, Write};

        // Reached only after a permitted TLS 1.2+ negotiation. Reuse the session
        // opened by `handshake`; if it is somehow absent, nothing is sent.
        let Some(mut stream) = self.session.take() else {
            return PublishOutcome::Retryable(
                "no established TLS session available for send".to_string(),
            );
        };

        let path = Self::split_endpoint(endpoint)
            .map(|(_, _, p)| p)
            .unwrap_or_else(|| "/".to_string());
        let host = Self::split_endpoint(endpoint)
            .map(|(h, _, _)| h)
            .unwrap_or_default();

        // Minimal HTTP/1.1 POST over the established TLS stream. The API key is
        // sent as a bearer credential; it is a runtime-resolved value and is
        // never logged (requirement 8.12).
        let request = format!(
            "POST {path} HTTP/1.1\r\n\
             host: {host}\r\n\
             authorization: Bearer {api_key}\r\n\
             content-type: application/json\r\n\
             content-length: {}\r\n\
             connection: close\r\n\r\n",
            body.len()
        );

        if stream.write_all(request.as_bytes()).is_err() || stream.write_all(body).is_err() {
            return PublishOutcome::Retryable("uplink write failed".to_string());
        }
        if stream.flush().is_err() {
            return PublishOutcome::Retryable("uplink flush failed".to_string());
        }

        // Read the status line to classify the outcome (design Section 6.2).
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response);
        let status = parse_http_status(&response);
        match status {
            Some(code) if (200..300).contains(&code) => PublishOutcome::Acknowledged,
            // 4xx (except 429) is a permanent rejection to retain as diagnostic.
            Some(code) if (400..500).contains(&code) && code != 429 => {
                PublishOutcome::Permanent(format!("ingestion rejected frame: HTTP {code}"))
            }
            // 5xx / 429 are transient: keep the frame queued.
            Some(code) => {
                PublishOutcome::Retryable(format!("ingestion transient error: HTTP {code}"))
            }
            None => PublishOutcome::Retryable("unparseable uplink response".to_string()),
        }
    }
}

/// Parse the numeric status code from an HTTP/1.x response's status line
/// (`HTTP/1.1 200 OK`). Returns `None` when the buffer does not start with a
/// recognizable status line.
fn parse_http_status(response: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(response).ok()?;
    let first_line = text.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let _http = parts.next()?; // "HTTP/1.1"
    parts.next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    //! TLS uplink client tests (task 5.6). These exercise the security-critical
    //! abort/permit decision at the *client boundary* (on top of the pure
    //! contract tested in the parent module) using a scripted transport, plus
    //! the no-secret-in-config guarantee (requirement 8.12). Real network/TLS
    //! I/O is out of scope here and lives in [`RustlsTransport`].

    use super::*;
    use crate::telemetry::{
        FlightVector, PositionVector, SimulatorEngine, SystemsVector, TelemetryFrame,
    };
    use std::cell::Cell;

    /// A scripted transport that records whether `send_frame` was ever reached
    /// and returns a preset negotiation. This lets each test assert the
    /// security invariant directly: on an abort path, `sent` MUST remain false
    /// (no telemetry was transmitted).
    struct ScriptedTransport {
        negotiation: TlsNegotiation,
        sent: Cell<bool>,
        send_outcome: PublishOutcome,
    }

    impl ScriptedTransport {
        fn new(negotiation: TlsNegotiation) -> Self {
            Self {
                negotiation,
                sent: Cell::new(false),
                send_outcome: PublishOutcome::Acknowledged,
            }
        }
    }

    impl TlsTransport for ScriptedTransport {
        fn handshake(&mut self, _endpoint: &str) -> TlsNegotiation {
            self.negotiation
        }

        fn send_frame(&mut self, _endpoint: &str, _api_key: &str, _body: &[u8]) -> PublishOutcome {
            self.sent.set(true);
            self.send_outcome.clone()
        }
    }

    /// A resolver that always yields a fixed key, standing in for an OS
    /// keychain/env lookup at runtime (no secret in the binary — 8.12).
    struct FixedResolver(&'static str);
    impl SecretResolver for FixedResolver {
        fn resolve(&self, _reference: &SecretReference) -> Result<String, String> {
            Ok(self.0.to_string())
        }
    }

    /// A resolver that always fails, standing in for a missing/locked secret.
    struct MissingResolver;
    impl SecretResolver for MissingResolver {
        fn resolve(&self, reference: &SecretReference) -> Result<String, String> {
            Err(format!("no entry for {:?}", reference.key))
        }
    }

    fn reference() -> SecretReference {
        SecretReference {
            key: "VIRTUALHEMS_UPLINK_API_KEY".to_string(),
        }
    }

    fn sample_frame() -> TelemetryFrame {
        TelemetryFrame {
            frame_id: "11111111-1111-1111-1111-111111111111".into(),
            pilot_id: "22222222-2222-2222-2222-222222222222".into(),
            mission_id: None,
            source_engine: SimulatorEngine::Xplane12,
            sequence_number: 1,
            observed_at: "2024-01-01T00:00:00.000Z".into(),
            received_at: None,
            position: PositionVector {
                latitude_deg: 40.44,
                longitude_deg: -79.99,
                altitude_msl_ft: 1200.0,
                altitude_agl_ft: 300.0,
            },
            flight: FlightVector {
                ground_speed_kts: 120.0,
                heading_deg: 270.0,
                vertical_speed_fpm: -500.0,
                pitch_deg: 2.0,
                roll_deg: -5.0,
            },
            systems: SystemsVector {
                fuel_remaining_lbs: 800.0,
                engine_torque_pct: 65.0,
                tot_celsius: None,
                rotor_rpm_pct: None,
                outside_air_temp_c: None,
            },
            is_delta: false,
            schema_version: crate::SCHEMA_VERSION.to_string(),
        }
    }

    fn client(
        negotiation: TlsNegotiation,
    ) -> TlsUplink<ScriptedTransport, FixedResolver> {
        TlsUplink::with_resolver(
            "https://cloud.example/telemetry",
            reference(),
            ScriptedTransport::new(negotiation),
            FixedResolver("resolved-at-runtime-key"),
        )
    }

    // ---- requirement 8.8: session cannot be established -> abort, no send ----

    #[test]
    fn aborts_and_sends_nothing_when_session_not_established() {
        let mut uplink = client(TlsNegotiation::NotEstablished);
        let outcome = uplink.publish(&sample_frame());

        assert_eq!(outcome, PublishOutcome::Offline, "no session must not send");
        assert!(
            !uplink.transport.sent.get(),
            "no telemetry byte may be transmitted when no TLS session exists (8.8)"
        );
        assert!(uplink.last_diagnostic().is_some());
    }

    // ---- requirement 8.8a: negotiated below 1.2 -> abort, no send ------------

    #[test]
    fn aborts_and_sends_nothing_when_negotiated_below_minimum() {
        for below in [TlsVersion::Tls1_0, TlsVersion::Tls1_1] {
            let mut uplink = client(TlsNegotiation::Established(below));
            let outcome = uplink.publish(&sample_frame());

            assert!(
                matches!(outcome, PublishOutcome::Retryable(_)),
                "a sub-1.2 negotiation must not acknowledge a send (8.8a)"
            );
            assert!(
                !uplink.transport.sent.get(),
                "no telemetry may be transmitted over a sub-1.2 session (8.8a): {below:?}"
            );
            let diag = uplink.last_diagnostic().unwrap();
            assert!(
                diag.contains("no telemetry"),
                "diagnostic must state nothing was sent: {diag}"
            );
        }
    }

    // ---- requirement 8.8: negotiated 1.2 or higher -> permitted, sends -------

    #[test]
    fn permits_and_sends_when_negotiated_at_or_above_minimum() {
        for ok in [TlsVersion::Tls1_2, TlsVersion::Tls1_3] {
            let mut uplink = client(TlsNegotiation::Established(ok));
            let outcome = uplink.publish(&sample_frame());

            assert_eq!(
                outcome,
                PublishOutcome::Acknowledged,
                "TLS {ok:?} meets the 1.2 floor and the frame is sent (8.8)"
            );
            assert!(
                uplink.transport.sent.get(),
                "a permitted TLS {ok:?} session must transmit the frame (8.8)"
            );
        }
    }

    // ---- requirement 8.12: no secret embedded; resolved at runtime -----------

    #[test]
    fn config_holds_only_a_reference_not_a_secret_value() {
        // The client stores a SecretReference (a key name), never the key
        // material. We assert the reference carries no secret-looking value and
        // that the struct exposes no secret accessor.
        let uplink = client(TlsNegotiation::Established(TlsVersion::Tls1_2));
        assert_eq!(uplink.api_key_reference.key, "VIRTUALHEMS_UPLINK_API_KEY");
        // The reference is a name, not a bearer secret: it does not contain the
        // resolved key value that the FixedResolver would supply at runtime.
        assert!(!uplink
            .api_key_reference
            .key
            .contains("resolved-at-runtime-key"));
    }

    #[test]
    fn aborts_before_sending_when_secret_cannot_be_resolved() {
        // Even on a permitted TLS 1.2+ session, a frame is never sent
        // unauthenticated: an unresolved secret aborts before send (8.12).
        let mut uplink = TlsUplink::with_resolver(
            "https://cloud.example/telemetry",
            reference(),
            ScriptedTransport::new(TlsNegotiation::Established(TlsVersion::Tls1_2)),
            MissingResolver,
        );
        let outcome = uplink.publish(&sample_frame());
        assert!(matches!(outcome, PublishOutcome::Retryable(_)));
        assert!(
            !uplink.transport.sent.get(),
            "a frame must not be transmitted when the API key cannot be resolved (8.12)"
        );
    }

    #[test]
    fn production_version_mapping_treats_unknown_as_below_floor() {
        assert_eq!(
            RustlsTransport::map_protocol_version(rustls::ProtocolVersion::TLSv1_3),
            TlsVersion::Tls1_3
        );
        assert_eq!(
            RustlsTransport::map_protocol_version(rustls::ProtocolVersion::TLSv1_2),
            TlsVersion::Tls1_2
        );
        // Anything we cannot positively identify as >=1.2 maps below the floor
        // so `tls_transmission_permitted` aborts (defense in depth, 8.8a).
        assert!(
            !RustlsTransport::map_protocol_version(rustls::ProtocolVersion::TLSv1_1).meets_minimum()
        );
        assert!(
            !RustlsTransport::map_protocol_version(rustls::ProtocolVersion::TLSv1_0).meets_minimum()
        );
        assert!(
            !RustlsTransport::map_protocol_version(rustls::ProtocolVersion::SSLv3).meets_minimum()
        );
    }

    #[test]
    fn endpoint_parsing_splits_host_port_and_path() {
        assert_eq!(
            RustlsTransport::split_endpoint("https://cloud.example/telemetry"),
            Some(("cloud.example".to_string(), 443, "/telemetry".to_string()))
        );
        assert_eq!(
            RustlsTransport::split_endpoint("https://cloud.example:8443/v1/ingest"),
            Some(("cloud.example".to_string(), 8443, "/v1/ingest".to_string()))
        );
        assert_eq!(
            RustlsTransport::split_endpoint("https://cloud.example"),
            Some(("cloud.example".to_string(), 443, "/".to_string()))
        );
        // Non-https or malformed endpoints yield None -> treated as no session.
        assert_eq!(RustlsTransport::split_endpoint("http://insecure/x"), None);
        assert_eq!(RustlsTransport::split_endpoint("cloud.example/x"), None);
    }
}
