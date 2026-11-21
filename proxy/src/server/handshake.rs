//! The HTTP side of the tunnel: reading request heads, checking the WebSocket upgrade request and
//! writing responses

use std::{
    fmt::Write,
    io,
    net::{IpAddr, SocketAddr},
    time::Duration,
};

use http::{Method, Request, Response, StatusCode, Version, header};
use httparse::Status;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use tungstenite::handshake::server::{create_response, write_response};

use telesignal_tunnel::{TARGET_PORT, get_allowed_host, head::HeadError};

use super::config::Config;

const TUNNEL_PATH: &str = "/tunnel";
const HEALTH_PATH: &str = "/health";
const MAX_REQUEST_HEADERS: usize = 64;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);
/// After an error response, the tunnel reads and discards what the client still sends for a moment,
/// so that closing a socket with unread data does not reset the connection before the client
/// reads the response
const LINGER_TIMEOUT: Duration = Duration::from_secs(1);
const LINGER_MAX_BYTES: usize = 64 << 10;
const LINGER_BUFFER_BYTES: usize = 4 << 10;

pub enum Route {
    Health,
    Tunnel,
}

pub struct TunnelRequest {
    /// The allowlist entry for the requested host
    pub host: &'static str,
    pub response: Response<()>,
}

/// A response that ends the connection without a tunnel
pub struct Reply {
    pub status: StatusCode,
    pub reason: &'static str,
    pub retry_after: Option<Duration>,
    /// Counts toward a temporary ban of the client
    pub is_violation: bool,
    pub is_logged: bool,
}

pub fn parse_request(data: &[u8]) -> Result<Option<(usize, Request<()>)>, HeadError> {
    let mut headers = [httparse::EMPTY_HEADER; MAX_REQUEST_HEADERS];
    let mut parsed = httparse::Request::new(&mut headers);
    let length = match parsed.parse(data) {
        Ok(Status::Complete(length)) => length,
        Ok(Status::Partial) => return Ok(None),
        Err(httparse::Error::TooManyHeaders) => return Err(HeadError::TooLarge),
        Err(_) => return Err(HeadError::Malformed),
    };
    let mut request = Request::builder()
        .method(parsed.method.unwrap_or_default())
        .uri(parsed.path.unwrap_or_default())
        .version(if parsed.version == Some(1) {
            Version::HTTP_11
        } else {
            Version::HTTP_10
        });
    for header in parsed.headers.iter() {
        request = request.header(header.name, header.value);
    }
    let request = request.body(()).map_err(|_| HeadError::Malformed)?;
    Ok(Some((length, request)))
}

pub fn route(request: &Request<()>) -> Result<Route, Reply> {
    let route = match request.uri().path() {
        HEALTH_PATH => Route::Health,
        TUNNEL_PATH => Route::Tunnel,
        _ => return Err(Reply::new(StatusCode::NOT_FOUND, "unknown path")),
    };
    if request.method() != Method::GET {
        return Err(Reply::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "method not allowed",
        ));
    }
    Ok(route)
}

/// Returns the peer address, or with `should_trust_proxy` the rightmost `X-Forwarded-For` address,
/// which the reverse proxy adds
pub fn get_client_ip(
    request: &Request<()>,
    should_trust_proxy: bool,
    peer: IpAddr,
) -> Result<IpAddr, Reply> {
    if !should_trust_proxy {
        return Ok(peer);
    }
    let Some(forwarded) = request
        .headers()
        .get_all("x-forwarded-for")
        .iter()
        .next_back()
    else {
        return Ok(peer);
    };
    let entry = forwarded
        .to_str()
        .ok()
        .and_then(|value| value.rsplit(',').next())
        .map(str::trim)
        .unwrap_or_default();
    entry
        .parse::<IpAddr>()
        .or_else(|_| entry.parse::<SocketAddr>().map(|address| address.ip()))
        .map_err(|_| Reply::new(StatusCode::BAD_REQUEST, "invalid X-Forwarded-For"))
}

pub fn check_tunnel_request(
    request: &Request<()>,
    config: &Config,
) -> Result<TunnelRequest, Reply> {
    let response =
        create_response(request).map_err(|_| Reply::malformed("not a WebSocket upgrade"))?;
    check_origin(request, config)?;
    let host = get_target(request.uri().query())?;
    Ok(TunnelRequest { host, response })
}

/// `Origin` stops other websites from using the tunnel through a visitor's browser; non-browser
/// clients can send any value
fn check_origin(request: &Request<()>, config: &Config) -> Result<(), Reply> {
    let mut origins = request.headers().get_all(header::ORIGIN).iter();
    match (origins.next(), origins.next()) {
        (None, _) if config.is_no_origin_allowed => Ok(()),
        (None, _) => Err(Reply::forbidden("missing Origin")),
        (Some(origin), None)
            if origin
                .to_str()
                .is_ok_and(|origin| config.origins.is_allowed(origin)) =>
        {
            Ok(())
        }
        _ => Err(Reply::forbidden("origin not allowed")),
    }
}

/// The allowlist holds DNS names only, so IP literals and every other host are refused
fn get_target(query: Option<&str>) -> Result<&'static str, Reply> {
    let mut host = None;
    let mut port = None;
    for pair in query.unwrap_or_default().split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        let parameter = match name {
            "host" => &mut host,
            "port" => &mut port,
            _ => continue,
        };
        if parameter.replace(value).is_some() {
            return Err(Reply::malformed("duplicate host or port"));
        }
    }
    let (Some(host), Some(port)) = (host, port) else {
        return Err(Reply::malformed("missing host or port"));
    };
    let is_target_port =
        port.bytes().all(|byte| byte.is_ascii_digit()) && port.parse() == Ok(TARGET_PORT);
    get_allowed_host(host)
        .filter(|_| is_target_port)
        .ok_or(Reply::forbidden("target not allowed"))
}

pub async fn send_upgrade(stream: &mut TcpStream, response: &Response<()>) -> io::Result<()> {
    let mut head = Vec::new();
    write_response(&mut head, response).map_err(io::Error::other)?;
    timeout(RESPONSE_TIMEOUT, stream.write_all(&head)).await?
}

/// Sends `reply` as plain text and closes the connection
pub async fn send_reply(stream: &mut TcpStream, reply: &Reply) {
    let Reply { status, reason, .. } = reply;
    let mut response = format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n",
        reason.len() + 1
    );
    if let Some(wait) = reply.retry_after {
        // Whole seconds, rounded up
        let seconds = wait.as_secs() + u64::from(wait.subsec_nanos() > 0);
        let _ = write!(response, "Retry-After: {}\r\n", seconds.max(1));
    }
    let _ = write!(response, "\r\n{reason}\n");
    if matches!(
        timeout(RESPONSE_TIMEOUT, stream.write_all(response.as_bytes())).await,
        Ok(Ok(()))
    ) {
        linger(stream).await;
    }
}

async fn linger(stream: &mut TcpStream) {
    if stream.shutdown().await.is_err() {
        return;
    }
    let mut buffer = [0; LINGER_BUFFER_BYTES];
    let mut discarded = 0;
    let _ = timeout(LINGER_TIMEOUT, async {
        while discarded < LINGER_MAX_BYTES {
            match stream.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => discarded += read,
            }
        }
    })
    .await;
}

impl Reply {
    pub fn new(status: StatusCode, reason: &'static str) -> Self {
        Self {
            status,
            reason,
            retry_after: None,
            is_violation: false,
            is_logged: true,
        }
    }

    pub fn health() -> Self {
        Self {
            is_logged: false,
            ..Self::new(StatusCode::OK, "ok")
        }
    }

    pub fn malformed(reason: &'static str) -> Self {
        Self {
            is_violation: true,
            ..Self::new(StatusCode::BAD_REQUEST, reason)
        }
    }

    fn forbidden(reason: &'static str) -> Self {
        Self {
            is_violation: true,
            ..Self::new(StatusCode::FORBIDDEN, reason)
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::server::config::OriginPolicy;
    use telesignal_tunnel::limits::LimitConfig;

    const KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
    const TARGET: &str = "/tunnel?host=chat.signal.org&port=443";

    fn build_head(target: &str, origins: &[&str]) -> String {
        let mut head = format!(
            "GET {target} HTTP/1.1\r\nHost: tunnel.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {KEY}\r\n"
        );
        for origin in origins {
            let _ = write!(head, "Origin: {origin}\r\n");
        }
        head.push_str("\r\n");
        head
    }

    fn parse(head: &str) -> Request<()> {
        let parsed = parse_request(head.as_bytes());
        let (length, request) = parsed.ok().flatten().unwrap();
        assert_eq!(length, head.len());
        request
    }

    fn get_target_of(query: &str) -> Result<&'static str, StatusCode> {
        get_target(Some(query)).map_err(|reply| reply.status)
    }

    fn build_config(origins: OriginPolicy, is_no_origin_allowed: bool) -> Config {
        Config {
            listen: "127.0.0.1:0".parse().unwrap(),
            origins,
            is_no_origin_allowed,
            upstream_proxy: None,
            should_trust_proxy: false,
            should_log_client_ips: false,
            limits: LimitConfig {
                max_tunnels: 1,
                max_tunnels_per_ip: 1,
                new_tunnels_per_ip_per_minute: 1,
                bandwidth_per_ip: 1,
                bandwidth_burst_per_ip: 1,
                hourly_bytes_per_ip: None,
                ban_after_violations: None,
                ban_window: Duration::ZERO,
                ban_duration: Duration::ZERO,
                max_tracked_ips: 1,
            },
            max_handshakes: 1,
            max_request_head_bytes: 1,
            max_message_bytes: 1,
            handshake_timeout: Duration::ZERO,
            connect_timeout: Duration::ZERO,
            idle_timeout: Duration::ZERO,
        }
    }

    fn get_status(result: Result<TunnelRequest, Reply>) -> Option<StatusCode> {
        result.err().map(|reply| reply.status)
    }

    #[test]
    fn accepts_allowlisted_targets_on_port_443() {
        assert_eq!(
            get_target_of("host=chat.signal.org&port=443"),
            Ok("chat.signal.org")
        );
        assert_eq!(
            get_target_of("port=443&host=cdn3.signal.org&ignored=1"),
            Ok("cdn3.signal.org")
        );
    }

    #[test]
    fn refuses_other_targets() {
        for query in [
            "",
            "host=chat.signal.org",
            "port=443",
            "host=chat.signal.org&port=80",
            "host=chat.signal.org&port=8443",
            "host=chat.signal.org&port=%34%34%33",
            "host=chat.signal.org&port=+443",
            "host=chat.signal.org&port=443.0",
            "host=chat.signal.org&port=",
            "host=example.com&port=443",
            "host=127.0.0.1&port=443",
            "host=%5B::1%5D&port=443",
            "host=CHAT.SIGNAL.ORG&port=443",
            "host=chat.signal.org.&port=443",
            "host=chat.signal.org:443&port=443",
            "host=chat%2Esignal.org&port=443",
            "host=chat.signal.org%00&port=443",
            "host=chat.signal.org&host=example.com&port=443",
            "host=example.com&host=chat.signal.org&port=443",
            "host=chat.signal.org&port=443&port=80",
        ] {
            assert!(get_target_of(query).is_err(), "accepted {query:?}");
        }
        assert!(get_target(None).is_err());
    }

    #[test]
    fn routes_only_get_requests_to_known_paths() {
        let route_of = |line: &str| route(&parse(&format!("{line} HTTP/1.1\r\n\r\n")));
        assert!(matches!(route_of("GET /tunnel?host=a"), Ok(Route::Tunnel)));
        assert!(matches!(route_of("GET /health"), Ok(Route::Health)));
        for line in [
            "GET /",
            "GET /tunnel/",
            "GET //tunnel",
            "GET /Tunnel",
            "POST /tunnel",
            "CONNECT chat.signal.org:443",
        ] {
            assert!(route_of(line).is_err(), "routed {line:?}");
        }
    }

    #[test]
    fn rejects_malformed_request_heads() {
        assert!(matches!(
            parse_request(b"GET /tunnel HTTP/1.1\r\nHost"),
            Ok(None)
        ));
        assert!(parse_request(b"\x16\x03\x01\x00\x05hello").is_err());
        assert!(parse_request(b"GET /tunnel HTTP/1.1\r\nBad Header: x\r\n\r\n").is_err());
        let many = format!("GET /tunnel HTTP/1.1\r\n{}\r\n", "A: b\r\n".repeat(65));
        assert!(matches!(
            parse_request(many.as_bytes()),
            Err(HeadError::TooLarge)
        ));
    }

    #[test]
    fn matches_origins_exactly() {
        let loopback = OriginPolicy::Loopback;
        for origin in [
            "http://localhost",
            "http://localhost:1234",
            "http://127.0.0.1:8080",
            "http://[::1]:5173",
        ] {
            assert!(loopback.is_allowed(origin), "refused {origin:?}");
        }
        for origin in [
            "",
            "null",
            "https://localhost:1234",
            "http://localhost.evil.example",
            "http://localhost:1234@evil.example",
            "http://localhost:0",
            "http://localhost:99999",
            "http://localhostevil",
            "http://127.0.0.1.evil.example",
            "http://evil.example/http://localhost",
            "http://localhost:1234/",
            "tauri://localhost",
        ] {
            assert!(!loopback.is_allowed(origin), "accepted {origin:?}");
        }

        let exact = OriginPolicy::Exact(["https://app.example".to_owned()].into());
        assert!(exact.is_allowed("https://app.example"));
        for origin in [
            "https://app.example/",
            "https://app.example:443",
            "https://APP.example",
            "http://app.example",
            "https://app.example.evil.example",
            "https://evil.example",
        ] {
            assert!(!exact.is_allowed(origin), "accepted {origin:?}");
        }
    }

    #[test]
    fn requires_an_allowed_origin_for_the_upgrade() {
        let strict = build_config(OriginPolicy::Loopback, false);
        let relaxed = build_config(OriginPolicy::Loopback, true);
        let check = |config: &Config, target: &str, origins: &[&str]| {
            check_tunnel_request(&parse(&build_head(target, origins)), config)
        };

        let tunnel = check(&strict, TARGET, &["http://localhost:1234"]);
        assert_eq!(
            tunnel.ok().map(|tunnel| tunnel.host),
            Some("chat.signal.org")
        );
        assert_eq!(
            get_status(check(&strict, TARGET, &["https://evil.example"])),
            Some(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            get_status(check(&strict, TARGET, &[])),
            Some(StatusCode::FORBIDDEN)
        );
        // Without `Origin`, only non-browser clients connect: that is opt-in
        assert!(check(&relaxed, TARGET, &[]).is_ok());
        assert!(check(&relaxed, TARGET, &["https://evil.example"]).is_err());
        // Two `Origin` headers are refused even when one of them is allowed
        let origins = ["http://localhost", "https://evil.example"];
        assert!(check(&strict, TARGET, &origins).is_err());
        // A host outside the allowlist is refused even with a good `Origin`
        let target = "/tunnel?host=example.com&port=443";
        assert!(check(&strict, target, &["http://localhost:1234"]).is_err());
    }
}
