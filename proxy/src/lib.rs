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
//!
//! A front end that serves both [`TrafficClass`]es picks the upstream proxy of each connection with
//! [`ClassProxies::get`]. The WebSocket server in `main.rs` serves one class per instance: the web
//! app picks the instance with its proxy settings, and the operator picks its `UPSTREAM_PROXY`.

#![forbid(unsafe_code)]

pub mod head;
pub mod limits;
pub mod relay;
pub mod tls;
pub mod upstream;

use upstream::UpstreamProxy;

pub const TARGET_PORT: u16 = 443;

/// Whether a connection carries credentials of the account (`TrafficClass` in
/// `src/lib/signal/config.ts`). The two classes use separate upstreams, so that traffic without
/// credentials, such as sealed sender sends, is not linked to the account by the address it comes
/// from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrafficClass {
    Authenticated,
    Unauthenticated,
}

impl TrafficClass {
    /// Parses the class name that the web app sends
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "authenticated" => Some(Self::Authenticated),
            "unauthenticated" => Some(Self::Unauthenticated),
            _ => None,
        }
    }
}

/// The upstream proxy of each traffic class, `None` for a direct connection
#[derive(Default)]
pub struct ClassProxies {
    pub authenticated: Option<UpstreamProxy>,
    /// Without its own proxy, unauthenticated connections use the authenticated class's, as the web
    /// app's sealed sender proxy setting falls back to the proxy server
    pub unauthenticated: Option<UpstreamProxy>,
}

impl ClassProxies {
    pub fn get(&self, class: TrafficClass) -> Option<&UpstreamProxy> {
        match class {
            TrafficClass::Authenticated => self.authenticated.as_ref(),
            TrafficClass::Unauthenticated => self
                .unauthenticated
                .as_ref()
                .or(self.authenticated.as_ref()),
        }
    }
}

/// Hosts the client needs (`src/lib/signal/config.ts`), all on [`TARGET_PORT`]
pub const ALLOWED_HOSTS: [&str; 10] = [
    "chat.signal.org",
    "storage.signal.org",
    "cdn.signal.org",
    "cdn2.signal.org",
    "cdn3.signal.org",
    "cdsi.signal.org",
    "contentproxy.signal.org",
    "sfu.voip.signal.org",
    "svr2.signal.org",
    "svrb.signal.org",
];

/// Returns the allowlist entry equal to `host`. The allowlist holds DNS names only, so IP literals
/// and every other host are refused.
pub fn get_allowed_host(host: &str) -> Option<&'static str> {
    ALLOWED_HOSTS.into_iter().find(|allowed| *allowed == host)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_exact_signal_host_names() {
        for host in ALLOWED_HOSTS {
            assert_eq!(get_allowed_host(host), Some(host));
        }
        for host in [
            "",
            "signal.org",
            "Chat.Signal.Org",
            "chat.signal.org.",
            "chat.signal.org:443",
            "chat.signal.org/",
            "chat.signal.org\0",
            "chat.signal.org.evil.example",
            "evil.chat.signal.org",
            "1.1.1.1",
            "127.0.0.1",
            "[::1]",
            "0x7f000001",
            "localhost",
            "telegram.org",
        ] {
            assert_eq!(get_allowed_host(host), None, "allowed {host:?}");
        }
    }

    #[test]
    fn parses_traffic_classes() {
        assert_eq!(
            TrafficClass::parse("authenticated"),
            Some(TrafficClass::Authenticated)
        );
        assert_eq!(
            TrafficClass::parse("unauthenticated"),
            Some(TrafficClass::Unauthenticated)
        );
        for name in ["", "Authenticated", "unauthenticated ", "sealed"] {
            assert_eq!(TrafficClass::parse(name), None, "parsed {name:?}");
        }
    }

    #[test]
    fn picks_the_proxy_of_each_class() {
        let proxy = |address: &str| UpstreamProxy::parse(address).unwrap();
        let address = |proxies: &ClassProxies, class| proxies.get(class).map(|p| p.address.clone());

        let none = ClassProxies::default();
        assert_eq!(address(&none, TrafficClass::Authenticated), None);
        assert_eq!(address(&none, TrafficClass::Unauthenticated), None);

        let main_only = ClassProxies {
            authenticated: Some(proxy("http://main.example:1")),
            unauthenticated: None,
        };
        assert_eq!(
            address(&main_only, TrafficClass::Unauthenticated).as_deref(),
            Some("main.example:1")
        );

        let both = ClassProxies {
            authenticated: Some(proxy("http://main.example:1")),
            unauthenticated: Some(proxy("http://sealed.example:2")),
        };
        assert_eq!(
            address(&both, TrafficClass::Authenticated).as_deref(),
            Some("main.example:1")
        );
        assert_eq!(
            address(&both, TrafficClass::Unauthenticated).as_deref(),
            Some("sealed.example:2")
        );

        // Direct connections for the authenticated class stay direct when only the other class has a proxy
        let sealed_only = ClassProxies {
            authenticated: None,
            unauthenticated: Some(proxy("http://sealed.example:2")),
        };
        assert_eq!(address(&sealed_only, TrafficClass::Authenticated), None);
    }

    #[test]
    fn lists_only_lowercase_signal_host_names() {
        for host in ALLOWED_HOSTS {
            assert!(host.ends_with(".signal.org"), "{host}");
            assert_eq!(host, host.to_ascii_lowercase());
        }
    }
}
