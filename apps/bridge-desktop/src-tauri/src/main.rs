//! Virtual HEMS desktop bridge entry point.
//!
//! The full Tauri v2 runtime, SimConnect/X-Plane adapters, offline queue, and
//! TLS uplink are layered in during the bridge tasks. This entry point exists
//! so the crate builds and the workspace foundation is complete.

fn main() {
    println!(
        "Virtual HEMS bridge (schema {})",
        virtualhems_bridge::schema_version()
    );
}
