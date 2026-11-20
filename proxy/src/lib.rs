//! Transport-independent core of the TeleSignal tunnel, shared by the WebSocket server in
//! `main.rs` and usable from other front ends such as Tauri commands. A front end:
//!
//! 1. Checks the requested host with [`get_allowed_host`].
//! 2. Reserves a tunnel for the client with [`limits::Limits::acquire`].
//! 3. Opens the upstream connection with [`upstream::connect`], optionally through an
//!    [`upstream::UpstreamProxy`].
//! 4. Runs [`relay::relay`] with the client's bytes as a `Stream` and a `Sink` for bytes to the
//!    client. The relay checks the ClientHello, then relays in both directions with the client's
//!    bandwidth limits, and returns why the tunnel ended.

#![forbid(unsafe_code)]

pub mod head;
pub mod limits;
pub mod relay;
pub mod tls;
pub mod upstream;

pub const TARGET_PORT: u16 = 443;

/// Hosts the client needs (`src/lib/signal/config.ts`), all on [`TARGET_PORT`]
pub const ALLOWED_HOSTS: [&str; 8] = [
    "chat.signal.org",
    "storage.signal.org",
    "cdn.signal.org",
    "cdn2.signal.org",
    "cdn3.signal.org",
    "cdsi.signal.org",
    "contentproxy.signal.org",
    "sfu.voip.signal.org",
];

/// Returns the allowlist entry equal to `host`. The allowlist holds DNS names only, so IP literals
/// and every other host are refused.
pub fn get_allowed_host(host: &str) -> Option<&'static str> {
    ALLOWED_HOSTS.into_iter().find(|allowed| *allowed == host)
}
