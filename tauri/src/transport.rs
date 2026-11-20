//! Native transport for the Signal engine. The web app runs TLS in WebAssembly, trusting only
//! Signal's certificate authority, and sends the encrypted bytes through these commands. They open
//! TCP connections to allowlisted Signal hosts and relay with the tunnel library
//! (`proxy/src/lib.rs`), which applies the same host allowlist, public-address check and ClientHello
//! check as the WebSocket tunnel, without a local port.
//!
//! Buffers are bounded in both directions: `signal_send` waits while [`SEND_QUEUE_CHUNKS`] chunks
//! wait for the upstream, and the relay stops reading from the upstream while
//! [`RECEIVE_WINDOW_BYTES`] sent to the web app are not acknowledged with `signal_ack`.

use std::{
  collections::HashMap,
  net::{IpAddr, Ipv4Addr},
  pin::pin,
  sync::{
    Arc, Mutex, MutexGuard, PoisonError,
    atomic::{AtomicBool, AtomicU32, Ordering},
  },
  time::Duration,
};

use futures_util::{sink, stream};
use tauri::{
  Webview,
  ipc::{Channel, InvokeBody, InvokeResponseBody, Request},
};
use telesignal_tunnel::{
  get_allowed_host,
  limits::{LimitConfig, Limits, Refusal},
  relay::{self, ClientError, ClientOutput, End, Tunnel},
  upstream::{self, UpstreamProxy},
};
use tokio::{
  sync::{Semaphore, mpsc},
  time::timeout,
};

/// Bytes per `signal_send` call; the web app splits larger writes (`NativeTransport.ts`)
pub const MAX_SEND_BYTES: usize = 64 << 10;
/// Chunks from the web app queued for the upstream before `signal_send` waits
const SEND_QUEUE_CHUNKS: usize = 4;
/// Bytes delivered to the web app before it must acknowledge them. Each delivery is at most
/// `relay::UPSTREAM_READ_BYTES`.
pub const RECEIVE_WINDOW_BYTES: usize = 1 << 20;
const MAX_CONNECTIONS: usize = 32;
/// Stops a reconnect loop from opening connections without pause
const NEW_CONNECTIONS_PER_MINUTE: u32 = 120;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// Signal clients send keepalives every 30 s; idle HTTP connections close after this time
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// `signal_send` names its connection in this header, as the body holds the raw bytes
const CONNECTION_HEADER: &str = "signal-connection";
/// Every connection belongs to the app itself, so the tunnel's per-client limits use one key
const CLIENT_IP: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

/// What a connection delivers to its owner
pub enum Event {
  Data(Vec<u8>),
  /// The connection ended for the given reason; no events follow
  Closed(String),
}

/// Open connections and the limits they share
pub struct Transport {
  limits: Arc<Limits>,
  proxy: Option<UpstreamProxy>,
  next_id: AtomicU32,
  connections: Mutex<HashMap<u32, Connection>>,
}

struct Connection {
  /// The webview that opened the connection; its reload or close ends the connection
  owner: String,
  input: mpsc::Sender<Vec<u8>>,
  window: Arc<ReceiveWindow>,
}

/// Bytes the owner may receive before it acknowledges earlier ones
struct ReceiveWindow {
  permits: Semaphore,
  unacknowledged: Mutex<usize>,
}

impl Transport {
  /// `proxy` routes upstream connections through an HTTP `CONNECT` proxy, which resolves names
  /// itself, so the public-address check does not apply to it
  pub fn new(proxy: Option<UpstreamProxy>) -> Self {
    Self {
      limits: Limits::new(LimitConfig {
        max_tunnels: MAX_CONNECTIONS,
        max_tunnels_per_ip: MAX_CONNECTIONS,
        new_tunnels_per_ip_per_minute: NEW_CONNECTIONS_PER_MINUTE,
        // The app does not limit its own bandwidth
        bandwidth_per_ip: u64::MAX,
        bandwidth_burst_per_ip: u64::MAX,
        hourly_bytes_per_ip: None,
        ban_after_violations: None,
        ban_window: Duration::ZERO,
        ban_duration: Duration::ZERO,
        max_tracked_ips: 1,
      }),
      proxy,
      next_id: AtomicU32::new(1),
      connections: Mutex::default(),
    }
  }

  /// Reads `UPSTREAM_PROXY`, an `http://[user:password@]host:port` URL, like the WebSocket tunnel
  pub fn from_env() -> Self {
    let proxy = std::env::var("UPSTREAM_PROXY")
      .ok()
      .filter(|url| !url.is_empty())
      .and_then(|url| match UpstreamProxy::parse(&url) {
        Ok(proxy) => Some(proxy),
        Err(err) => {
          log::error!("Ignoring UPSTREAM_PROXY: {err}");
          None
        }
      });
    Self::new(proxy)
  }

  /// Connects to `host` on port 443 and returns the connection ID. The first bytes sent must be a
  /// TLS ClientHello for `host`. `on_event` receives the upstream's bytes and then one
  /// [`Event::Closed`]; an error from it means the owner is gone.
  pub async fn connect<F>(
    self: &Arc<Self>,
    host: &str,
    owner: &str,
    on_event: F,
  ) -> Result<u32, String>
  where
    F: Fn(Event) -> Result<(), ()> + Send + Sync + 'static,
  {
    let host = get_allowed_host(host).ok_or_else(|| format!("Host {host} is not allowed"))?;
    let slot = self.limits.acquire(CLIENT_IP).map_err(|refusal| {
      match refusal {
        Refusal::TunnelRate(_) => "Too many new connections",
        _ => "Too many connections",
      }
      .to_string()
    })?;
    let upstream = timeout(
      CONNECT_TIMEOUT,
      upstream::connect(host, self.proxy.as_ref()),
    )
    .await
    .map_err(|_| format!("Connection to {host} timed out"))?
    .map_err(|err| format!("Connection to {host} failed: {err}"))?;

    let id = self.next_id.fetch_add(1, Ordering::Relaxed);
    let (input, client_rx) = mpsc::channel(SEND_QUEUE_CHUNKS);
    let window = Arc::new(ReceiveWindow {
      permits: Semaphore::new(RECEIVE_WINDOW_BYTES),
      unacknowledged: Mutex::new(0),
    });
    self.lock().insert(
      id,
      Connection {
        owner: owner.to_string(),
        input,
        window: Arc::clone(&window),
      },
    );

    let transport = Arc::clone(self);
    tokio::spawn(async move {
      let on_event = Arc::new(on_event);
      let is_closed = Arc::new(AtomicBool::new(false));
      let mut client_rx = pin!(stream::unfold(client_rx, |mut client_rx| async move {
        let data = client_rx.recv().await?;
        Some((Ok::<_, ClientError>(data), client_rx))
      }));
      let mut client_tx = pin!(sink::unfold(
        (Arc::clone(&on_event), Arc::clone(&is_closed), window),
        |(on_event, is_closed, window), output| async move {
          match output {
            ClientOutput::Data(data) => {
              window.reserve(data.len()).await;
              on_event(Event::Data(data))?;
            }
            // Reported at once, so the web app stops using the connection; the relay still
            // waits briefly for the web app to finish
            ClientOutput::Finished => {
              if !is_closed.swap(true, Ordering::Relaxed) {
                on_event(Event::Closed(End::UpstreamClosed.to_string()))?;
              }
            }
          }
          Ok::<_, ()>((on_event, is_closed, window))
        },
      ));
      let tunnel = Tunnel {
        host,
        slot: &slot,
        hello_timeout: HELLO_TIMEOUT,
        idle_timeout: IDLE_TIMEOUT,
      };
      let end = relay::relay(
        &tunnel,
        &mut client_rx,
        &mut client_tx,
        upstream,
        std::future::pending(),
      )
      .await;
      transport.lock().remove(&id);
      if end.is_violation() {
        log::warn!("Signal connection to {host} ended: {end}");
      }
      if !is_closed.swap(true, Ordering::Relaxed) {
        let _ = on_event(Event::Closed(end.to_string()));
      }
    });

    Ok(id)
  }

  /// Queues bytes for the upstream, waiting while the queue is full
  pub async fn send(&self, id: u32, data: Vec<u8>) -> Result<(), String> {
    if data.len() > MAX_SEND_BYTES {
      return Err(format!("Send at most {MAX_SEND_BYTES} bytes at once"));
    }
    let input = self.get_connection(id, |connection| connection.input.clone())?;
    input
      .send(data)
      .await
      .map_err(|_| "The connection is closed".to_string())
  }

  /// Releases received bytes the owner has processed, so the relay delivers more
  pub fn acknowledge(&self, id: u32, byte_length: usize) -> Result<(), String> {
    let window = self.get_connection(id, |connection| Arc::clone(&connection.window))?;
    window.release(byte_length);
    Ok(())
  }

  /// Ends the connection; its owner then receives [`Event::Closed`]
  pub fn close(&self, id: u32) {
    self.lock().remove(&id);
  }

  /// Ends the connections of a webview that reloads or closes
  pub fn close_owned_by(&self, owner: &str) {
    self
      .lock()
      .retain(|_, connection| connection.owner != owner);
  }

  fn get_connection<T>(&self, id: u32, get: impl FnOnce(&Connection) -> T) -> Result<T, String> {
    self
      .lock()
      .get(&id)
      .map(get)
      .ok_or_else(|| "The connection is closed".to_string())
  }

  fn lock(&self) -> MutexGuard<'_, HashMap<u32, Connection>> {
    self
      .connections
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
  }
}

impl ReceiveWindow {
  async fn reserve(&self, byte_length: usize) {
    // `byte_length` is at most `relay::UPSTREAM_READ_BYTES`, so it fits in `u32` and the window
    let permits = u32::try_from(byte_length).unwrap_or(u32::MAX);
    if let Ok(permit) = self.permits.acquire_many(permits).await {
      permit.forget();
    }
    *self.lock() += byte_length;
  }

  /// Releases at most the bytes delivered and not acknowledged yet, so the window never grows
  fn release(&self, byte_length: usize) {
    let mut unacknowledged = self.lock();
    let released = byte_length.min(*unacknowledged);
    *unacknowledged -= released;
    self.permits.add_permits(released);
  }

  fn lock(&self) -> MutexGuard<'_, usize> {
    self
      .unacknowledged
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
  }
}

/// Opens a connection to a Signal host; `on_event` receives `ArrayBuffer` data and then
/// `{ closed: reason }`
#[tauri::command]
pub async fn signal_connect(
  webview: Webview,
  transport: tauri::State<'_, Arc<Transport>>,
  host: String,
  on_event: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
  transport
    .connect(&host, webview.label(), move |event| {
      let body = match event {
        Event::Data(data) => InvokeResponseBody::Raw(data),
        Event::Closed(reason) => {
          InvokeResponseBody::Json(serde_json::json!({ "closed": reason }).to_string())
        }
      };
      on_event.send(body).map_err(|_| ())
    })
    .await
}

/// Sends the raw request body on the connection named by the `signal-connection` header. Resolves
/// once the bytes are queued, so the web app sends one chunk at a time and keeps their order.
#[tauri::command]
pub async fn signal_send(
  transport: tauri::State<'_, Arc<Transport>>,
  request: Request<'_>,
) -> Result<(), String> {
  let id = request
    .headers()
    .get(CONNECTION_HEADER)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.parse().ok())
    .ok_or_else(|| format!("Missing {CONNECTION_HEADER} header"))?;
  let InvokeBody::Raw(data) = request.body() else {
    return Err("Expected raw bytes".to_string());
  };
  transport.send(id, data.clone()).await
}

#[tauri::command]
pub fn signal_ack(
  transport: tauri::State<'_, Arc<Transport>>,
  id: u32,
  byte_length: usize,
) -> Result<(), String> {
  transport.acknowledge(id, byte_length)
}

#[tauri::command]
pub fn signal_close(transport: tauri::State<'_, Arc<Transport>>, id: u32) {
  transport.close(id);
}

// Tests that reach Signal are ignored by default: run them with
// `UPSTREAM_PROXY=$HTTPS_PROXY cargo test -- --include-ignored` where outbound traffic needs a proxy
#[cfg(test)]
mod tests {
  use super::*;

  const HOST: &str = "chat.signal.org";
  const EVENT_TIMEOUT: Duration = Duration::from_secs(15);
  const CONTENT_TYPE_HANDSHAKE: u8 = 22;
  const CONTENT_TYPE_ALERT: u8 = 21;

  #[tokio::test]
  async fn refuses_hosts_outside_the_allowlist() {
    let transport = Arc::new(Transport::new(None));
    for host in ["example.com", "signal.org", "127.0.0.1", "chat.signal.org."] {
      let result = transport.connect(host, "test", |_| Ok(())).await;
      assert!(result.is_err(), "{host} was allowed");
    }
  }

  #[tokio::test]
  async fn bounds_the_receive_window() {
    let window = ReceiveWindow {
      permits: Semaphore::new(RECEIVE_WINDOW_BYTES),
      unacknowledged: Mutex::new(0),
    };
    window.reserve(RECEIVE_WINDOW_BYTES).await;
    let is_blocked = timeout(Duration::from_millis(100), window.reserve(1))
      .await
      .is_err();
    assert!(is_blocked, "the window grew past its size");

    // Acknowledging more than was delivered releases only what was delivered
    window.release(2 * RECEIVE_WINDOW_BYTES);
    assert_eq!(window.permits.available_permits(), RECEIVE_WINDOW_BYTES);
  }

  #[tokio::test]
  #[ignore = "connects to Signal"]
  async fn relays_a_client_hello_for_the_host() {
    let transport = Arc::new(Transport::from_env());
    let (id, mut events) = connect(&transport).await;
    transport.send(id, build_client_hello(HOST)).await.unwrap();

    let Some(Event::Data(data)) = receive(&mut events).await else {
      panic!("expected the server's reply");
    };
    // A ServerHello, or an alert for the minimal ClientHello, came back through the relay
    assert!([CONTENT_TYPE_HANDSHAKE, CONTENT_TYPE_ALERT].contains(&data[0]));

    transport.close(id);
    assert!(matches!(
      receive_until_closed(&mut events).await.as_str(),
      "client closed" | "upstream closed"
    ));
    assert!(transport.send(id, vec![0]).await.is_err());
  }

  #[tokio::test]
  #[ignore = "connects to Signal"]
  async fn refuses_a_client_hello_for_another_host() {
    let transport = Arc::new(Transport::from_env());
    let (id, mut events) = connect(&transport).await;
    transport
      .send(id, build_client_hello("example.com"))
      .await
      .unwrap();

    assert_eq!(
      receive_until_closed(&mut events).await,
      "server name mismatch"
    );
  }

  #[tokio::test]
  #[ignore = "connects to Signal"]
  async fn refuses_data_that_is_not_tls() {
    let transport = Arc::new(Transport::from_env());
    let (id, mut events) = connect(&transport).await;
    transport
      .send(id, b"GET / HTTP/1.1\r\n\r\n".to_vec())
      .await
      .unwrap();

    assert_eq!(
      receive_until_closed(&mut events).await,
      "not a TLS handshake"
    );
  }

  async fn connect(transport: &Arc<Transport>) -> (u32, mpsc::UnboundedReceiver<Event>) {
    let (sender, events) = mpsc::unbounded_channel();
    let id = transport
      .connect(HOST, "test", move |event| {
        sender.send(event).map_err(|_| ())
      })
      .await
      .unwrap();
    (id, events)
  }

  async fn receive(events: &mut mpsc::UnboundedReceiver<Event>) -> Option<Event> {
    timeout(EVENT_TIMEOUT, events.recv()).await.unwrap()
  }

  async fn receive_until_closed(events: &mut mpsc::UnboundedReceiver<Event>) -> String {
    loop {
      match receive(events).await {
        Some(Event::Closed(reason)) => return reason,
        Some(Event::Data(_)) => {}
        None => panic!("the connection ended without `Event::Closed`"),
      }
    }
  }

  /// A minimal TLS 1.2 ClientHello with one server name
  fn build_client_hello(host: &str) -> Vec<u8> {
    let name = host.as_bytes();
    let mut server_name = Vec::new();
    push_u16(&mut server_name, name.len() + 3);
    server_name.push(0);
    push_u16(&mut server_name, name.len());
    server_name.extend_from_slice(name);

    let mut extensions = Vec::new();
    push_extension(&mut extensions, 0, &server_name);
    // `supported_groups`: x25519, secp256r1
    push_extension(&mut extensions, 10, &[0, 4, 0, 29, 0, 23]);
    // `signature_algorithms`: ecdsa_secp256r1_sha256, rsa_pss_rsae_sha256, rsa_pkcs1_sha256
    push_extension(&mut extensions, 13, &[0, 6, 4, 3, 8, 4, 4, 1]);

    let mut body = vec![3, 3];
    body.extend_from_slice(&[7; 32]);
    body.push(0);
    // ECDHE-ECDSA and ECDHE-RSA with AES-128-GCM
    body.extend_from_slice(&[0, 4, 0xc0, 0x2b, 0xc0, 0x2f]);
    body.extend_from_slice(&[1, 0]);
    push_u16(&mut body, extensions.len());
    body.extend_from_slice(&extensions);

    let mut handshake = vec![1, 0];
    push_u16(&mut handshake, body.len());
    handshake.extend_from_slice(&body);

    let mut record = vec![CONTENT_TYPE_HANDSHAKE, 3, 1];
    push_u16(&mut record, handshake.len());
    record.extend_from_slice(&handshake);
    record
  }

  fn push_extension(extensions: &mut Vec<u8>, extension_type: u16, data: &[u8]) {
    extensions.extend_from_slice(&extension_type.to_be_bytes());
    push_u16(extensions, data.len());
    extensions.extend_from_slice(data);
  }

  fn push_u16(buffer: &mut Vec<u8>, value: usize) {
    buffer.extend_from_slice(&u16::try_from(value).unwrap().to_be_bytes());
  }
}
