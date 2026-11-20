//! WebSocket-to-TCP tunnel for TeleSignal. The browser runs TLS to Signal's servers itself and
//! sends the encrypted bytes through `GET /tunnel?host=<host>&port=443`; see `README.md`.

#![forbid(unsafe_code)]

mod server {
    pub mod config;
    pub mod handshake;
    pub mod websocket;
}

use std::{
    fmt::{self, Display},
    io::{self, Write},
    net::{IpAddr, SocketAddr},
    process::ExitCode,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use http::StatusCode;
use telesignal_tunnel::{
    head::{HeadError, read_head},
    limits::{Limits, Refusal, TunnelSlot},
    relay::Tunnel,
    upstream::{self, Upstream},
};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, Semaphore, mpsc, watch},
    time::{Instant, interval, sleep, timeout},
};
use tokio_tungstenite::WebSocketStream;
use tungstenite::protocol::Role;

use crate::server::{
    config::Config,
    handshake::{self, Reply, Route},
    websocket,
};

const PRUNE_INTERVAL: Duration = Duration::from_secs(60);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const ACCEPT_ERROR_DELAY: Duration = Duration::from_millis(100);
/// `Retry-After` for a client at its concurrent tunnel limit
const CLIENT_TUNNELS_RETRY_AFTER: Duration = Duration::from_secs(1);

macro_rules! log {
    ($($arg:tt)*) => {
        $crate::write_log(format_args!($($arg)*))
    };
}

struct Server {
    config: Config,
    limits: Arc<Limits>,
    shutdown: watch::Receiver<bool>,
    next_tunnel_id: AtomicU64,
}

/// A tunnel that passed the HTTP checks, with its upstream connection
struct OpenTunnel {
    id: u64,
    host: &'static str,
    client_ip: IpAddr,
    slot: TunnelSlot,
    upstream: Upstream,
    /// WebSocket bytes the client sent with the request head
    early_data: Vec<u8>,
}

/// A reply to send instead of a tunnel, and the client its violation counts against, when known
type Refused = (Reply, Option<IpAddr>);

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::load() {
        Ok(config) => config,
        Err(err) => {
            log!("invalid configuration: {err}");
            return ExitCode::from(2);
        }
    };
    let mut shutdown_signal = match ShutdownSignal::new() {
        Ok(signal) => signal,
        Err(err) => {
            log!("cannot listen for signals: {err}");
            return ExitCode::FAILURE;
        }
    };
    let listener = match TcpListener::bind(config.listen).await {
        Ok(listener) => listener,
        Err(err) => {
            log!("cannot listen on {}: {err}", config.listen);
            return ExitCode::FAILURE;
        }
    };
    log!(
        "listening on {}, allowing {}, upstream {}",
        listener.local_addr().unwrap_or(config.listen),
        config.origins,
        config
            .upstream_proxy
            .as_ref()
            .map_or("direct", |proxy| proxy.address.as_str())
    );

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    // Each connection task holds a sender; `recv` returns `None` once all have finished
    let (done_tx, mut done_rx) = mpsc::channel::<()>(1);
    let handshakes = Arc::new(Semaphore::new(config.max_handshakes));
    let limits = Limits::new(config.limits.clone());
    tokio::spawn(prune_limits(Arc::clone(&limits)));
    let server = Arc::new(Server {
        config,
        limits,
        shutdown: shutdown_rx,
        next_tunnel_id: AtomicU64::new(1),
    });

    let mut is_handshake_limit_logged = false;
    loop {
        let (stream, peer) = tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(accepted) => accepted,
                Err(err) => {
                    log!("accept failed: {err}");
                    sleep(ACCEPT_ERROR_DELAY).await;
                    continue;
                }
            },
            signal = shutdown_signal.recv() => {
                log!("received {signal}, closing {} tunnels", server.limits.get_open_count());
                break;
            }
        };
        // Bounds connections that have not finished the HTTP handshake, such as slow senders
        let Ok(permit) = Arc::clone(&handshakes).try_acquire_owned() else {
            if !is_handshake_limit_logged {
                log!("handshake limit reached, dropping new connections");
                is_handshake_limit_logged = true;
            }
            continue;
        };
        is_handshake_limit_logged = false;
        let server = Arc::clone(&server);
        let done = done_tx.clone();
        tokio::spawn(async move {
            serve(&server, stream, peer, permit).await;
            drop(done);
        });
    }

    drop(listener);
    shutdown_tx.send_replace(true);
    drop(done_tx);
    if timeout(SHUTDOWN_TIMEOUT, done_rx.recv()).await.is_err() {
        log!(
            "shutdown timed out with {} tunnels open",
            server.limits.get_open_count()
        );
    }
    ExitCode::SUCCESS
}

async fn serve(
    server: &Server,
    mut stream: TcpStream,
    peer: SocketAddr,
    permit: OwnedSemaphorePermit,
) {
    let _ = stream.set_nodelay(true);
    let tunnel = tokio::select! {
        tunnel = open_tunnel(server, &mut stream, peer.ip()) => tunnel,
        () = wait_for_shutdown(server.shutdown.clone()) => Ok(None),
    };
    drop(permit);
    match tunnel {
        Ok(Some(tunnel)) => run_tunnel(server, stream, tunnel).await,
        Ok(None) => {}
        Err((reply, client_ip)) => refuse(server, &mut stream, &reply, client_ip).await,
    }
}

async fn open_tunnel(
    server: &Server,
    stream: &mut TcpStream,
    peer: IpAddr,
) -> Result<Option<OpenTunnel>, Refused> {
    let config = &server.config;
    // Behind a trusted reverse proxy the peer is the proxy, so only requests with a known client
    // address count toward bans
    let peer_ip = (!config.should_trust_proxy).then_some(peer);

    let head = read_head(
        stream,
        config.max_request_head_bytes,
        handshake::parse_request,
    );
    let (request, early_data) = match timeout(config.handshake_timeout, head).await {
        Ok(Ok(head)) => head,
        Ok(Err(HeadError::Closed)) => return Ok(None),
        Ok(Err(HeadError::TooLarge)) => {
            let reply = Reply::new(
                StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE,
                "request head too large",
            );
            return Err((
                Reply {
                    is_violation: true,
                    ..reply
                },
                peer_ip,
            ));
        }
        Ok(Err(HeadError::Malformed)) => {
            return Err((Reply::malformed("malformed request"), peer_ip));
        }
        Err(_) => {
            let reply = Reply::new(StatusCode::REQUEST_TIMEOUT, "handshake timeout");
            return Err((
                Reply {
                    is_violation: true,
                    ..reply
                },
                peer_ip,
            ));
        }
    };

    if let Route::Health = handshake::route(&request).map_err(|reply| (reply, peer_ip))? {
        return Err((Reply::health(), None));
    }
    let client_ip = handshake::get_client_ip(&request, config.should_trust_proxy, peer)
        .map_err(|reply| (reply, None))?;
    server
        .limits
        .check_ban(client_ip)
        .map_err(|wait| (get_refusal_reply(Refusal::Banned(wait)), None))?;
    let request = handshake::check_tunnel_request(&request, config)
        .map_err(|reply| (reply, Some(client_ip)))?;
    let slot = server
        .limits
        .acquire(client_ip)
        .map_err(|refusal| (get_refusal_reply(refusal), Some(client_ip)))?;

    let id = server.next_tunnel_id.fetch_add(1, Ordering::Relaxed);
    let host = request.host;
    let connect = upstream::connect(host, config.upstream_proxy.as_ref());
    let upstream = match timeout(config.connect_timeout, connect).await {
        Ok(Ok(upstream)) => upstream,
        Ok(Err(err)) => {
            log!("tunnel {id} to {host} failed: {err}");
            return Err((
                Reply::new(StatusCode::BAD_GATEWAY, "upstream connection failed"),
                None,
            ));
        }
        Err(_) => {
            log!("tunnel {id} to {host} failed: connect timeout");
            return Err((
                Reply::new(StatusCode::GATEWAY_TIMEOUT, "upstream connect timeout"),
                None,
            ));
        }
    };
    if handshake::send_upgrade(stream, &request.response)
        .await
        .is_err()
    {
        return Ok(None);
    }
    Ok(Some(OpenTunnel {
        id,
        host,
        client_ip,
        slot,
        upstream,
        early_data,
    }))
}

async fn run_tunnel(server: &Server, stream: TcpStream, tunnel: OpenTunnel) {
    let OpenTunnel {
        id,
        host,
        client_ip,
        slot,
        upstream,
        early_data,
    } = tunnel;
    let config = &server.config;
    let started = Instant::now();
    log!(
        "tunnel {id} to {host} open{} ({} open)",
        ClientLabel(config, Some(client_ip)),
        server.limits.get_open_count()
    );

    let websocket_config = websocket::get_config(config.max_message_bytes);
    let websocket = WebSocketStream::from_partially_read(
        stream,
        early_data,
        Role::Server,
        Some(websocket_config),
    )
    .await;
    let tunnel = Tunnel {
        host,
        slot: &slot,
        hello_timeout: config.handshake_timeout,
        idle_timeout: config.idle_timeout,
    };
    let end = websocket::relay(
        &tunnel,
        websocket,
        upstream,
        wait_for_shutdown(server.shutdown.clone()),
    )
    .await;
    let is_banned = end.is_violation() && slot.record_violation();
    drop(slot);

    log!(
        "tunnel {id} to {host} closed: {end} after {}s ({} open)",
        started.elapsed().as_secs(),
        server.limits.get_open_count()
    );
    if is_banned {
        log_ban(config, client_ip);
    }
}

async fn refuse(server: &Server, stream: &mut TcpStream, reply: &Reply, client_ip: Option<IpAddr>) {
    if reply.is_logged {
        log!(
            "refused {}: {}{}",
            reply.status.as_u16(),
            reply.reason,
            ClientLabel(&server.config, client_ip)
        );
    }
    if let Some(client_ip) = client_ip.filter(|_| reply.is_violation) {
        if server.limits.record_violation(client_ip) {
            log_ban(&server.config, client_ip);
        }
    }
    handshake::send_reply(stream, reply).await;
}

fn get_refusal_reply(refusal: Refusal) -> Reply {
    let too_many_requests = |reason, wait| Reply {
        retry_after: Some(wait),
        ..Reply::new(StatusCode::TOO_MANY_REQUESTS, reason)
    };
    match refusal {
        // Logged once when the ban starts
        Refusal::Banned(wait) => Reply {
            is_logged: false,
            ..too_many_requests("temporarily banned", wait)
        },
        Refusal::TooManyTunnels => {
            Reply::new(StatusCode::SERVICE_UNAVAILABLE, "tunnel limit reached")
        }
        Refusal::TooManyClients => Reply::new(StatusCode::SERVICE_UNAVAILABLE, "client table full"),
        Refusal::TooManyClientTunnels => too_many_requests(
            "too many tunnels from this client",
            CLIENT_TUNNELS_RETRY_AFTER,
        ),
        Refusal::TunnelRate(wait) => Reply {
            is_violation: true,
            ..too_many_requests("tunnel rate limit reached", wait)
        },
        Refusal::HourlyBytes(wait) => Reply {
            is_violation: true,
            ..too_many_requests("hourly byte limit reached", wait)
        },
    }
}

fn log_ban(config: &Config, client_ip: IpAddr) {
    log!(
        "banned client{} for {}s after repeated violations",
        ClientLabel(config, Some(client_ip)),
        config.limits.ban_duration.as_secs()
    );
}

async fn prune_limits(limits: Arc<Limits>) {
    let mut ticks = interval(PRUNE_INTERVAL);
    loop {
        ticks.tick().await;
        limits.prune();
    }
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    // The returned guard is dropped at once
    let _ = shutdown.wait_for(|&is_shutdown| is_shutdown).await;
}

struct ShutdownSignal {
    #[cfg(unix)]
    interrupt: tokio::signal::unix::Signal,
    #[cfg(unix)]
    terminate: tokio::signal::unix::Signal,
}

impl ShutdownSignal {
    #[cfg(unix)]
    fn new() -> io::Result<Self> {
        use tokio::signal::unix::{SignalKind, signal};

        Ok(Self {
            interrupt: signal(SignalKind::interrupt())?,
            terminate: signal(SignalKind::terminate())?,
        })
    }

    #[cfg(not(unix))]
    fn new() -> io::Result<Self> {
        Ok(Self {})
    }

    #[cfg(unix)]
    async fn recv(&mut self) -> &'static str {
        tokio::select! {
            _ = self.interrupt.recv() => "SIGINT",
            _ = self.terminate.recv() => "SIGTERM",
        }
    }

    #[cfg(not(unix))]
    async fn recv(&mut self) -> &'static str {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
        "Ctrl+C"
    }
}

/// ` from <ip>` when `LOG_CLIENT_IPS=1`
struct ClientLabel<'a>(&'a Config, Option<IpAddr>);

impl Display for ClientLabel<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.1 {
            Some(ip) if self.0.should_log_client_ips => write!(f, " from {ip}"),
            _ => Ok(()),
        }
    }
}

fn write_log(message: fmt::Arguments<'_>) {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let _ = writeln!(
        io::stdout().lock(),
        "[tunnel] {} {message}",
        UtcTime(seconds)
    );
}

/// ISO 8601 UTC time from Unix seconds
struct UtcTime(u64);

impl Display for UtcTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const SECONDS_PER_DAY: u64 = 86_400;
        let (days, time) = (self.0 / SECONDS_PER_DAY, self.0 % SECONDS_PER_DAY);
        // `civil_from_days` from https://howardhinnant.github.io/date_algorithms.html, for days
        // since 1970-01-01 in eras of 400 years that start on March 1
        let shifted_days = days + 719_468;
        let era = shifted_days / 146_097;
        let day_of_era = shifted_days % 146_097;
        let year_of_era =
            (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let month_index = (5 * day_of_year + 2) / 153;
        let day = day_of_year - (153 * month_index + 2) / 5 + 1;
        let month = if month_index < 10 {
            month_index + 3
        } else {
            month_index - 9
        };
        let year = era * 400 + year_of_era + u64::from(month <= 2);
        write!(
            f,
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
            time / 3600,
            time / 60 % 60,
            time % 60
        )
    }
}
