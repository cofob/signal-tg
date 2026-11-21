//! Connections to Signal hosts, directly or through an HTTP CONNECT proxy

use std::{
    fmt::{self, Display, Write},
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
};

use data_encoding::BASE64;
use http::Uri;
use httparse::Status;
use tokio::{
    io::AsyncWriteExt,
    net::{TcpStream, lookup_host},
};

use crate::{
    TARGET_PORT,
    head::{HeadError, read_head},
};

const MAX_PROXY_RESPONSE_HEAD_BYTES: usize = 8 << 10;
const MAX_PROXY_RESPONSE_HEADERS: usize = 64;

/// IPv4 ranges that are not publicly routable (IANA special-purpose registry)
const NON_PUBLIC_IPV4: [(Ipv4Addr, u32); 15] = [
    (Ipv4Addr::UNSPECIFIED, 8), // "This network", includes the unspecified address
    (Ipv4Addr::new(10, 0, 0, 0), 8), // Private
    (Ipv4Addr::new(100, 64, 0, 0), 10), // Shared address space (CGNAT)
    (Ipv4Addr::new(127, 0, 0, 0), 8), // Loopback
    (Ipv4Addr::new(169, 254, 0, 0), 16), // Link-local
    (Ipv4Addr::new(172, 16, 0, 0), 12), // Private
    (Ipv4Addr::new(192, 0, 0, 0), 24), // IETF protocol assignments
    (Ipv4Addr::new(192, 0, 2, 0), 24), // Documentation
    (Ipv4Addr::new(192, 88, 99, 0), 24), // 6to4 relay anycast
    (Ipv4Addr::new(192, 168, 0, 0), 16), // Private
    (Ipv4Addr::new(198, 18, 0, 0), 15), // Benchmarking
    (Ipv4Addr::new(198, 51, 100, 0), 24), // Documentation
    (Ipv4Addr::new(203, 0, 113, 0), 24), // Documentation
    (Ipv4Addr::new(224, 0, 0, 0), 4), // Multicast
    (Ipv4Addr::new(240, 0, 0, 0), 4), // Reserved, includes broadcast
];
/// Public IPv6 addresses are global unicast, `2000::/3`, outside the ranges below
const IPV6_GLOBAL_UNICAST: (Ipv6Addr, u32) = (Ipv6Addr::new(0x2000, 0, 0, 0, 0, 0, 0, 0), 3);
const NON_PUBLIC_IPV6: [(Ipv6Addr, u32); 4] = [
    (Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23), // IETF protocol assignments, includes Teredo
    (Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32), // Documentation
    (Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16), // 6to4
    (Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20), // Documentation
];
/// NAT64 embeds an IPv4 address, which is checked instead
const IPV6_NAT64: (Ipv6Addr, u32) = (Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96);

const PROXY_URL_ERROR: &str = "the proxy must be an http://[user:password@]host:port URL";

/// An HTTP proxy that accepts `CONNECT`
pub struct UpstreamProxy {
    /// `host:port`, with an IPv6 host in brackets
    pub address: String,
    /// Base64 `user:password` for `Proxy-Authorization: Basic`
    credentials: Option<String>,
}

pub struct Upstream {
    pub stream: TcpStream,
    /// Bytes the proxy sent after its response head
    pub leftover: Vec<u8>,
}

pub enum ConnectError {
    Resolve(io::Error),
    NoPublicAddress,
    Connect(io::Error),
    Proxy(io::Error),
    ProxyResponse(&'static str),
    ProxyRefused(u16),
}

/// Connects to `host` (from the allowlist) on port 443. Without a proxy, the name is resolved once
/// and only public addresses are tried; with a proxy, the proxy resolves the name, so the address
/// check does not apply.
pub async fn connect(host: &str, proxy: Option<&UpstreamProxy>) -> Result<Upstream, ConnectError> {
    let upstream = match proxy {
        Some(proxy) => connect_through_proxy(host, proxy).await?,
        None => Upstream {
            stream: connect_directly(host).await?,
            leftover: Vec::new(),
        },
    };
    // Tunnel traffic is interactive TLS records
    let _ = upstream.stream.set_nodelay(true);
    Ok(upstream)
}

async fn connect_directly(host: &str) -> Result<TcpStream, ConnectError> {
    let mut error = ConnectError::NoPublicAddress;
    for address in lookup_host((host, TARGET_PORT))
        .await
        .map_err(ConnectError::Resolve)?
    {
        let ip = address.ip().to_canonical();
        if !is_public(ip) {
            continue;
        }
        match TcpStream::connect(SocketAddr::new(ip, address.port())).await {
            Ok(stream) => return Ok(stream),
            Err(err) => error = ConnectError::Connect(err),
        }
    }
    Err(error)
}

async fn connect_through_proxy(
    host: &str,
    proxy: &UpstreamProxy,
) -> Result<Upstream, ConnectError> {
    let mut stream = TcpStream::connect(proxy.address.as_str())
        .await
        .map_err(ConnectError::Proxy)?;
    let mut request =
        format!("CONNECT {host}:{TARGET_PORT} HTTP/1.1\r\nHost: {host}:{TARGET_PORT}\r\n");
    if let Some(credentials) = &proxy.credentials {
        let _ = write!(request, "Proxy-Authorization: Basic {credentials}\r\n");
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(ConnectError::Proxy)?;

    let (status, leftover) = read_head(
        &mut stream,
        MAX_PROXY_RESPONSE_HEAD_BYTES,
        parse_proxy_response,
    )
    .await
    .map_err(|err| {
        ConnectError::ProxyResponse(match err {
            HeadError::TooLarge => "response head too large",
            HeadError::Malformed => "malformed response",
            HeadError::Closed => "connection closed",
        })
    })?;
    if !(200..300).contains(&status) {
        return Err(ConnectError::ProxyRefused(status));
    }
    Ok(Upstream { stream, leftover })
}

impl UpstreamProxy {
    /// Parses `http://[user:password@]host:port`, with percent-encoded credentials
    pub fn parse(url: &str) -> Result<Self, &'static str> {
        let uri = url.parse::<Uri>().map_err(|_| PROXY_URL_ERROR)?;
        let authority = uri
            .authority()
            .filter(|_| {
                uri.scheme_str() == Some("http") && uri.path() == "/" && uri.query().is_none()
            })
            .ok_or(PROXY_URL_ERROR)?;
        let host = authority.host();
        let port = authority.port_u16().ok_or(PROXY_URL_ERROR)?;
        if host.is_empty() {
            return Err(PROXY_URL_ERROR);
        }

        let credentials = match authority.as_str().rsplit_once('@') {
            None => None,
            Some((user_info, _)) => {
                let (user, password) = user_info.split_once(':').unwrap_or((user_info, ""));
                let mut decoded = decode_percent(user).ok_or(PROXY_URL_ERROR)?;
                decoded.push(b':');
                decoded.extend(decode_percent(password).ok_or(PROXY_URL_ERROR)?);
                Some(BASE64.encode(&decoded))
            }
        };
        Ok(Self {
            address: format!("{host}:{port}"),
            credentials,
        })
    }
}

fn decode_percent(value: &str) -> Option<Vec<u8>> {
    let mut decoded = Vec::with_capacity(value.len());
    let mut bytes = value.bytes();
    while let Some(byte) = bytes.next() {
        if byte != b'%' {
            decoded.push(byte);
            continue;
        }
        let high = char::from(bytes.next()?).to_digit(16)?;
        let low = char::from(bytes.next()?).to_digit(16)?;
        decoded.push(u8::try_from(high * 16 + low).ok()?);
    }
    Some(decoded)
}

fn parse_proxy_response(data: &[u8]) -> Result<Option<(usize, u16)>, HeadError> {
    let mut headers = [httparse::EMPTY_HEADER; MAX_PROXY_RESPONSE_HEADERS];
    let mut response = httparse::Response::new(&mut headers);
    match response.parse(data) {
        Ok(Status::Complete(length)) => Ok(Some((length, response.code.unwrap_or_default()))),
        Ok(Status::Partial) => Ok(None),
        Err(httparse::Error::TooManyHeaders) => Err(HeadError::TooLarge),
        Err(_) => Err(HeadError::Malformed),
    }
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => {
            if let Some(ip) = ip.to_ipv4_mapped() {
                return is_public_ipv4(ip);
            }
            if is_in_ipv6_range(ip, IPV6_NAT64) {
                let [.., a, b, c, d] = ip.octets();
                return is_public_ipv4(Ipv4Addr::new(a, b, c, d));
            }
            is_in_ipv6_range(ip, IPV6_GLOBAL_UNICAST)
                && !NON_PUBLIC_IPV6
                    .iter()
                    .any(|&range| is_in_ipv6_range(ip, range))
        }
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    !NON_PUBLIC_IPV4.iter().any(|&(network, prefix_bits)| {
        let mask = u32::MAX.checked_shl(32 - prefix_bits).unwrap_or(0);
        ip.to_bits() & mask == network.to_bits()
    })
}

fn is_in_ipv6_range(ip: Ipv6Addr, (network, prefix_bits): (Ipv6Addr, u32)) -> bool {
    let mask = u128::MAX.checked_shl(128 - prefix_bits).unwrap_or(0);
    ip.to_bits() & mask == network.to_bits()
}

impl Display for ConnectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Resolve(err) => write!(f, "cannot resolve host: {err}"),
            Self::NoPublicAddress => f.write_str("host has no public address"),
            Self::Connect(err) => write!(f, "cannot connect: {err}"),
            Self::Proxy(err) => write!(f, "upstream proxy failed: {err}"),
            Self::ProxyResponse(reason) => write!(f, "upstream proxy failed: {reason}"),
            Self::ProxyRefused(status) => write!(f, "upstream proxy refused with status {status}"),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn is_public_address(address: &str) -> bool {
        // As `connect_directly` canonicalizes resolved addresses before the check
        is_public(address.parse::<IpAddr>().unwrap().to_canonical())
    }

    #[test]
    fn refuses_non_public_addresses() {
        for address in [
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "127.255.255.254",
            "169.254.169.254",
            "172.16.0.1",
            "172.31.255.255",
            "192.0.0.1",
            "192.0.2.1",
            "192.168.1.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::7f00:1",
            "64:ff9b::a9fe:a9fe",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "ff02::1",
            "2001::1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "3fff::1",
            "100::1",
        ] {
            assert!(!is_public_address(address), "{address} is public");
        }
    }

    #[test]
    fn accepts_public_addresses() {
        for address in [
            "1.1.1.1",
            "8.8.8.8",
            "172.15.255.255",
            "172.32.0.1",
            "100.63.255.255",
            "100.128.0.1",
            "198.17.255.255",
            "198.20.0.1",
            "2606:4700::1111",
            "2a00:1450:4001::200e",
            "::ffff:8.8.8.8",
            "64:ff9b::808:808",
        ] {
            assert!(is_public_address(address), "{address} is not public");
        }
    }

    #[test]
    fn parses_upstream_proxy_urls() {
        let proxy = UpstreamProxy::parse("http://proxy.example:3128").unwrap();
        assert_eq!(proxy.address, "proxy.example:3128");
        assert!(proxy.credentials.is_none());

        let proxy = UpstreamProxy::parse("http://user:p%40ss@[::1]:8080/").unwrap();
        assert_eq!(proxy.address, "[::1]:8080");
        assert_eq!(proxy.credentials.as_deref(), Some("dXNlcjpwQHNz"));

        for url in [
            "https://proxy.example:3128",
            "http://proxy.example",
            "http://proxy.example:3128/path",
            "http://proxy.example:3128/?q=1",
            "proxy.example:3128",
            "http://:3128",
            "http://user:%zz@proxy.example:3128",
        ] {
            assert!(UpstreamProxy::parse(url).is_err(), "accepted {url:?}");
        }
    }
}
