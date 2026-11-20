//! Configuration from environment variables, documented in `proxy/README.md`

use std::{
    collections::HashSet,
    env,
    fmt::{self, Display},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    str::FromStr,
    time::Duration,
};

use telesignal_tunnel::{limits::LimitConfig, upstream::UpstreamProxy};

const DEFAULT_PORT: u16 = 8787;
const DEFAULT_HOST: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
const DEFAULT_MAX_TUNNELS: usize = 64;
const DEFAULT_MAX_TUNNELS_PER_IP: usize = 16;
const DEFAULT_NEW_TUNNELS_PER_IP_PER_MINUTE: u32 = 60;
const DEFAULT_BANDWIDTH_PER_IP: u64 = 4 << 20;
const DEFAULT_BANDWIDTH_BURST_PER_IP: u64 = 16 << 20;
const DEFAULT_BAN_AFTER_VIOLATIONS: u32 = 10;
const DEFAULT_BAN_WINDOW_SECS: u64 = 600;
const DEFAULT_BAN_SECS: u64 = 900;
const DEFAULT_MAX_TRACKED_IPS: usize = 16_384;
const DEFAULT_MAX_HANDSHAKES: usize = 128;
const DEFAULT_MAX_REQUEST_HEAD_BYTES: usize = 8 << 10;
const DEFAULT_MAX_MESSAGE_BYTES: usize = 256 << 10;
const DEFAULT_HANDSHAKE_TIMEOUT_SECS: u64 = 10;
const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 10;
const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 120;
/// One year keeps deadlines far from `Instant` overflow
const MAX_SECONDS: u64 = 365 * 24 * 3600;
/// `src/lib/signal/net/TlsTunnel.ts` sends messages of up to this size
const MIN_MESSAGE_BYTES: usize = 64 << 10;
const LOOPBACK_ORIGINS: [&str; 3] = ["http://localhost", "http://127.0.0.1", "http://[::1]"];

pub struct Config {
    pub listen: SocketAddr,
    pub origins: OriginPolicy,
    pub is_no_origin_allowed: bool,
    pub upstream_proxy: Option<UpstreamProxy>,
    pub should_trust_proxy: bool,
    pub should_log_client_ips: bool,
    pub limits: LimitConfig,
    pub max_handshakes: usize,
    pub max_request_head_bytes: usize,
    pub max_message_bytes: usize,
    pub handshake_timeout: Duration,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
}

pub enum OriginPolicy {
    /// `http://localhost`, `http://127.0.0.1` and `http://[::1]` with any port
    Loopback,
    Exact(HashSet<String>),
}

impl Config {
    pub fn load() -> Result<Self, String> {
        let host = read_var("HOST")?
            .map(|value| value.parse::<IpAddr>())
            .transpose()
            .map_err(|_| "HOST must be an IP address".to_owned())?
            .unwrap_or(DEFAULT_HOST);
        if !host.is_loopback() && !read_flag("ALLOW_PUBLIC_BIND")? {
            return Err(format!(
                "refusing to listen on non-loopback address {host}: serve the tunnel behind a TLS reverse proxy and set ALLOW_PUBLIC_BIND=1"
            ));
        }

        let max_message_bytes = read_number("MAX_MESSAGE_BYTES", DEFAULT_MAX_MESSAGE_BYTES)?;
        if max_message_bytes < MIN_MESSAGE_BYTES {
            return Err(format!(
                "MAX_MESSAGE_BYTES must be at least {MIN_MESSAGE_BYTES}"
            ));
        }

        Ok(Self {
            listen: SocketAddr::new(host, read_number("PORT", DEFAULT_PORT)?),
            origins: read_origins()?,
            is_no_origin_allowed: read_flag("ALLOW_NO_ORIGIN")?,
            upstream_proxy: read_upstream_proxy()?,
            should_trust_proxy: read_flag("TRUST_PROXY")?,
            should_log_client_ips: read_flag("LOG_CLIENT_IPS")?,
            limits: LimitConfig {
                max_tunnels: read_number("MAX_TUNNELS", DEFAULT_MAX_TUNNELS)?,
                max_tunnels_per_ip: read_number("MAX_TUNNELS_PER_IP", DEFAULT_MAX_TUNNELS_PER_IP)?,
                new_tunnels_per_ip_per_minute: read_number(
                    "NEW_TUNNELS_PER_IP_PER_MINUTE",
                    DEFAULT_NEW_TUNNELS_PER_IP_PER_MINUTE,
                )?,
                bandwidth_per_ip: read_number("BANDWIDTH_PER_IP", DEFAULT_BANDWIDTH_PER_IP)?,
                bandwidth_burst_per_ip: read_number(
                    "BANDWIDTH_BURST_PER_IP",
                    DEFAULT_BANDWIDTH_BURST_PER_IP,
                )?,
                hourly_bytes_per_ip: read_optional_number("HOURLY_BYTES_PER_IP", None)?,
                ban_after_violations: read_optional_number(
                    "BAN_AFTER_VIOLATIONS",
                    Some(DEFAULT_BAN_AFTER_VIOLATIONS),
                )?,
                ban_window: read_seconds("BAN_WINDOW_SECS", DEFAULT_BAN_WINDOW_SECS)?,
                ban_duration: read_seconds("BAN_SECS", DEFAULT_BAN_SECS)?,
                max_tracked_ips: read_number("MAX_TRACKED_IPS", DEFAULT_MAX_TRACKED_IPS)?,
            },
            max_handshakes: read_number("MAX_HANDSHAKES", DEFAULT_MAX_HANDSHAKES)?,
            max_request_head_bytes: read_number(
                "MAX_REQUEST_HEAD_BYTES",
                DEFAULT_MAX_REQUEST_HEAD_BYTES,
            )?,
            max_message_bytes,
            handshake_timeout: read_seconds(
                "HANDSHAKE_TIMEOUT_SECS",
                DEFAULT_HANDSHAKE_TIMEOUT_SECS,
            )?,
            connect_timeout: read_seconds("CONNECT_TIMEOUT_SECS", DEFAULT_CONNECT_TIMEOUT_SECS)?,
            idle_timeout: read_seconds("IDLE_TIMEOUT_SECS", DEFAULT_IDLE_TIMEOUT_SECS)?,
        })
    }
}

impl OriginPolicy {
    pub fn is_allowed(&self, origin: &str) -> bool {
        match self {
            Self::Loopback => LOOPBACK_ORIGINS.iter().any(|prefix| {
                origin.strip_prefix(prefix).is_some_and(|rest| {
                    rest.is_empty() || rest.strip_prefix(':').is_some_and(is_port)
                })
            }),
            Self::Exact(origins) => origins.contains(origin),
        }
    }
}

impl Display for OriginPolicy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Loopback => f.write_str("loopback origins"),
            Self::Exact(origins) => {
                let mut origins: Vec<_> = origins.iter().map(String::as_str).collect();
                origins.sort_unstable();
                f.write_str(&origins.join(", "))
            }
        }
    }
}

fn read_origins() -> Result<OriginPolicy, String> {
    let Some(value) = read_var("ALLOWED_ORIGINS")? else {
        return Ok(OriginPolicy::Loopback);
    };
    let origins: HashSet<String> = value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_owned)
        .collect();
    if origins.is_empty() {
        return Err("ALLOWED_ORIGINS has no origins".to_owned());
    }
    if let Some(origin) = origins.iter().find(|origin| !is_origin(origin)) {
        return Err(format!(
            "ALLOWED_ORIGINS entry {origin:?} is not an origin such as https://example.com"
        ));
    }
    Ok(OriginPolicy::Exact(origins))
}

/// Checks the serialized form browsers send in `Origin`: a scheme and an authority, without a path.
/// The desktop app's page on macOS and Linux has the origin `tauri://localhost`.
fn is_origin(value: &str) -> bool {
    value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .or_else(|| value.strip_prefix("tauri://"))
        .is_some_and(|authority| {
            !authority.is_empty()
                && !authority.contains(['/', '?', '#', '@'])
                && !authority.chars().any(char::is_whitespace)
        })
}

fn is_port(value: &str) -> bool {
    value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<u16>().is_ok_and(|port| port != 0)
}

fn read_upstream_proxy() -> Result<Option<UpstreamProxy>, String> {
    read_var("UPSTREAM_PROXY")?
        .map(|url| UpstreamProxy::parse(&url).map_err(|err| format!("UPSTREAM_PROXY: {err}")))
        .transpose()
}

fn read_var(name: &str) -> Result<Option<String>, String> {
    match env::var(name) {
        Ok(value) if value.trim().is_empty() => Ok(None),
        Ok(value) => Ok(Some(value.trim().to_owned())),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(_)) => Err(format!("{name} is not valid UTF-8")),
    }
}

fn read_flag(name: &str) -> Result<bool, String> {
    match read_var(name)?.as_deref() {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        Some(_) => Err(format!("{name} must be 0 or 1")),
    }
}

/// Reads a positive integer
fn read_number<T: FromStr + PartialEq + From<u8>>(name: &str, default: T) -> Result<T, String> {
    match read_integer(name)? {
        None => Ok(default),
        Some(number) if number == T::from(0) => Err(format!("{name} must be positive")),
        Some(number) => Ok(number),
    }
}

/// Reads an integer where `0` turns the limit off
fn read_optional_number<T: FromStr + PartialEq + From<u8>>(
    name: &str,
    default: Option<T>,
) -> Result<Option<T>, String> {
    Ok(match read_integer(name)? {
        None => default,
        Some(number) => Some(number).filter(|number| *number != T::from(0)),
    })
}

fn read_integer<T: FromStr>(name: &str) -> Result<Option<T>, String> {
    read_var(name)?
        .map(|value| {
            value
                .parse::<T>()
                .map_err(|_| format!("{name} must be a non-negative integer"))
        })
        .transpose()
}

fn read_seconds(name: &str, default: u64) -> Result<Duration, String> {
    let seconds = read_number(name, default)?;
    if seconds > MAX_SECONDS {
        return Err(format!("{name} must be at most {MAX_SECONDS}"));
    }
    Ok(Duration::from_secs(seconds))
}
