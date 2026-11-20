//! Relays bytes between a client transport and an upstream TCP connection, after checking that the
//! client starts TLS to the requested host

use std::{
    fmt::{self, Display},
    pin::pin,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use futures_util::{Sink, SinkExt, Stream, StreamExt};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::tcp::{OwnedReadHalf, OwnedWriteHalf},
    time::{Instant, sleep, sleep_until, timeout},
};

use crate::{
    limits::{Direction, TunnelSlot},
    tls::{self, ClientHello},
    upstream::Upstream,
};

/// Upstream bytes per message to the client
pub const UPSTREAM_READ_BYTES: usize = 64 << 10;
/// Time allowed for the client to finish after the upstream did, and for the upstream shutdown
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub struct Tunnel<'a> {
    /// The allowlist entry the ClientHello must name
    pub host: &'static str,
    pub slot: &'a TunnelSlot,
    pub hello_timeout: Duration,
    pub idle_timeout: Duration,
}

/// Why the client transport stopped delivering data
#[derive(Clone, Copy)]
pub enum ClientError {
    /// The client broke the transport's rules, such as a text or oversized WebSocket message
    Violation(&'static str),
    Failed,
}

/// What the relay sends to the client
pub enum ClientOutput {
    Data(Vec<u8>),
    /// The upstream finished sending; the client should finish too
    Finished,
}

pub enum End {
    /// The client stream ended
    ClientClosed,
    ClientFailed,
    /// The client transport reported a violation
    ClientViolation(&'static str),
    /// The client did not start with a ClientHello for the tunnel's host
    BadClientHello(&'static str),
    HourlyBytes,
    UpstreamClosed,
    UpstreamFailed,
    Idle,
    Shutdown,
}

/// Relays between the client and `upstream` until either side ends, the tunnel idles or
/// `shutdown` completes. The client's data must start with a ClientHello for `tunnel.host` within
/// `tunnel.hello_timeout`. The caller closes the client transport afterwards, according to the
/// returned [`End`].
pub async fn relay<D, R, W>(
    tunnel: &Tunnel<'_>,
    client_rx: &mut R,
    client_tx: &mut W,
    upstream: Upstream,
    shutdown: impl Future<Output = ()>,
) -> End
where
    D: AsRef<[u8]>,
    R: Stream<Item = Result<D, ClientError>> + Unpin,
    W: Sink<ClientOutput> + Unpin,
{
    let (mut upstream_rx, mut upstream_tx) = upstream.stream.into_split();
    let mut shutdown = pin!(shutdown);
    let activity = Activity::new();
    let mut is_upstream_closed = false;

    let end = 'relay: {
        let hello = tokio::select! {
            hello = timeout(tunnel.hello_timeout, read_client_hello(client_rx, tunnel)) => match hello {
                Ok(Ok(hello)) => hello,
                Ok(Err(end)) => break 'relay end,
                Err(_) => break 'relay End::BadClientHello("ClientHello timeout"),
            },
            () = &mut shutdown => break 'relay End::Shutdown,
        };
        activity.record();
        if upstream_tx.write_all(&hello).await.is_err() {
            break 'relay End::UpstreamFailed;
        }

        let mut to_upstream = pin!(forward_to_upstream(
            client_rx,
            &mut upstream_tx,
            tunnel,
            &activity
        ));
        let mut to_client = pin!(forward_to_client(
            &mut upstream_rx,
            client_tx,
            upstream.leftover,
            tunnel,
            &activity
        ));
        let mut idle = pin!(wait_idle(&activity, tunnel.idle_timeout));
        let mut close_deadline = pin!(sleep(CLOSE_TIMEOUT));
        loop {
            tokio::select! {
                end = &mut to_upstream => break end,
                end = &mut to_client, if !is_upstream_closed => {
                    if !matches!(end, End::UpstreamClosed) {
                        break end;
                    }
                    // Client data still flows upstream until the client finishes too
                    is_upstream_closed = true;
                    close_deadline.as_mut().reset(Instant::now() + CLOSE_TIMEOUT);
                }
                () = &mut close_deadline, if is_upstream_closed => break End::UpstreamClosed,
                () = &mut idle => break End::Idle,
                () = &mut shutdown => break End::Shutdown,
            }
        }
    };

    let _ = timeout(CLOSE_TIMEOUT, upstream_tx.shutdown()).await;
    if is_upstream_closed {
        End::UpstreamClosed
    } else {
        end
    }
}

/// Buffers client data until it holds a ClientHello for the tunnel's host
async fn read_client_hello<D, R>(client: &mut R, tunnel: &Tunnel<'_>) -> Result<Vec<u8>, End>
where
    D: AsRef<[u8]>,
    R: Stream<Item = Result<D, ClientError>> + Unpin,
{
    let mut buffer = Vec::new();
    loop {
        let data = match client.next().await {
            Some(Ok(data)) => data,
            Some(Err(err)) => return Err(get_client_error_end(err)),
            None => return Err(End::ClientClosed),
        };
        let data = data.as_ref();
        if buffer.len() + data.len() > tls::MAX_CLIENT_HELLO_BYTES {
            return Err(End::BadClientHello("ClientHello too large"));
        }
        buffer.extend_from_slice(data);
        throttle(tunnel.slot, Direction::Upload, data.len()).await?;
        match tls::check_client_hello(&buffer, tunnel.host) {
            Ok(ClientHello::Valid) => return Ok(buffer),
            Ok(ClientHello::Incomplete) => {}
            Err(reason) => return Err(End::BadClientHello(reason)),
        }
    }
}

async fn forward_to_upstream<D, R>(
    client: &mut R,
    upstream: &mut OwnedWriteHalf,
    tunnel: &Tunnel<'_>,
    activity: &Activity,
) -> End
where
    D: AsRef<[u8]>,
    R: Stream<Item = Result<D, ClientError>> + Unpin,
{
    loop {
        let data = match client.next().await {
            Some(Ok(data)) => data,
            Some(Err(err)) => return get_client_error_end(err),
            None => return End::ClientClosed,
        };
        let data = data.as_ref();
        activity.record();
        if let Err(end) = throttle(tunnel.slot, Direction::Upload, data.len()).await {
            return end;
        }
        if upstream.write_all(data).await.is_err() {
            return End::UpstreamFailed;
        }
    }
}

async fn forward_to_client<W: Sink<ClientOutput> + Unpin>(
    upstream: &mut OwnedReadHalf,
    client: &mut W,
    leftover: Vec<u8>,
    tunnel: &Tunnel<'_>,
    activity: &Activity,
) -> End {
    if !leftover.is_empty() && client.send(ClientOutput::Data(leftover)).await.is_err() {
        return End::ClientFailed;
    }
    loop {
        let mut chunk = Vec::with_capacity(UPSTREAM_READ_BYTES);
        match upstream.read_buf(&mut chunk).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => return End::UpstreamFailed,
        }
        activity.record();
        if let Err(end) = throttle(tunnel.slot, Direction::Download, chunk.len()).await {
            return end;
        }
        if client.send(ClientOutput::Data(chunk)).await.is_err() {
            return End::ClientFailed;
        }
    }
    match client.send(ClientOutput::Finished).await {
        Ok(()) => End::UpstreamClosed,
        Err(_) => End::ClientFailed,
    }
}

/// Pauses reading in `direction` while the client exceeds its bandwidth
async fn throttle(slot: &TunnelSlot, direction: Direction, bytes: usize) -> Result<(), End> {
    let wait = slot
        .charge(direction, bytes)
        .map_err(|_| End::HourlyBytes)?;
    if !wait.is_zero() {
        sleep(wait).await;
    }
    Ok(())
}

async fn wait_idle(activity: &Activity, idle_timeout: Duration) {
    loop {
        let deadline = activity.get_last() + idle_timeout;
        if deadline <= Instant::now() {
            return;
        }
        sleep_until(deadline).await;
    }
}

fn get_client_error_end(err: ClientError) -> End {
    match err {
        ClientError::Violation(reason) => End::ClientViolation(reason),
        ClientError::Failed => End::ClientFailed,
    }
}

impl End {
    /// Whether the end counts toward a temporary ban of the client
    pub fn is_violation(&self) -> bool {
        matches!(self, Self::ClientViolation(_) | Self::BadClientHello(_))
    }
}

impl Display for End {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ClientClosed => f.write_str("client closed"),
            Self::ClientFailed => f.write_str("client connection failed"),
            Self::ClientViolation(reason) | Self::BadClientHello(reason) => f.write_str(reason),
            Self::HourlyBytes => f.write_str("hourly byte limit reached"),
            Self::UpstreamClosed => f.write_str("upstream closed"),
            Self::UpstreamFailed => f.write_str("upstream connection failed"),
            Self::Idle => f.write_str("idle timeout"),
            Self::Shutdown => f.write_str("shutdown"),
        }
    }
}

/// Time of the last data in either direction
struct Activity(Mutex<Instant>);

impl Activity {
    fn new() -> Self {
        Self(Mutex::new(Instant::now()))
    }

    fn record(&self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }

    fn get_last(&self) -> Instant {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
