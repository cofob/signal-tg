# TeleSignal tunnel

The browser cannot reach Signal servers directly: they present certificates from Signal's private
certificate authority, and browser `fetch` and `WebSocket` cannot pin it. TeleSignal therefore runs
TLS inside WebAssembly (rustls, trusting only Signal's CA) and sends the encrypted bytes through
this tunnel, which relays them as raw TCP to an allowlisted Signal host.

The crate has two parts:

- `src/lib.rs`, a transport-independent library: the host allowlist, upstream connections (address
  checks, optional HTTP `CONNECT` proxy), ClientHello checks and the byte relay with per-client
  limits. The desktop app's native transport (`tauri/src/transport.rs`) drives the same relay over
  Tauri IPC; see [Library](#library).
- `src/main.rs` and `src/server/`, the WebSocket server that the web app uses. The default `server`
  feature builds it; other front ends depend on the crate with `default-features = false`.

## Running

Needs Rust 1.85 or newer ([rustup](https://rustup.rs)).

```sh
npm run signal:proxy   # cargo run --release --locked --manifest-path proxy/Cargo.toml
```

It listens on `127.0.0.1:8787`. Set `SIGNAL_TUNNEL_URL=ws://localhost:8787/tunnel` in `.env` for
`npm run dev`. If outbound traffic must go through an HTTP proxy, as in some sandboxes, set
`UPSTREAM_PROXY=$HTTPS_PROXY`.

Checks: `cargo build --release`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.

## Protocol

- `GET /tunnel?host=<host>&port=443` with a WebSocket upgrade opens a tunnel. `host` must be one of
  `chat`, `storage`, `cdn`, `cdn2`, `cdn3`, `cdsi`, `contentproxy` or `sfu.voip` `.signal.org`, and
  `port` must be 443. Binary messages carry raw TCP bytes in both directions; the client sends
  messages of at most 64 KiB (`src/lib/signal/net/TlsTunnel.ts`).
- The first bytes from the client must be a TLS ClientHello whose only server name is `host`.
- `GET /health` returns `ok`.

The tunnel connects upstream before it answers the upgrade, so connection failures are HTTP errors.

| Status | Meaning |
| --- | --- |
| 400 | Malformed request, not a WebSocket upgrade, missing `host` or `port`, bad `X-Forwarded-For` |
| 403 | Origin not allowed, host or port not allowed |
| 404, 405 | Unknown path, method other than `GET` |
| 408 | Request head not received within `HANDSHAKE_TIMEOUT_SECS` |
| 429 | Client banned, over its tunnel rate, concurrent tunnels or hourly bytes; with `Retry-After` |
| 431 | Request head over `MAX_REQUEST_HEAD_BYTES` or 64 headers |
| 502, 504 | Upstream connection failed or timed out |
| 503 | Global tunnel limit or client table full |

After the upgrade, the tunnel closes the WebSocket with:

| Code | Meaning |
| --- | --- |
| 1000 | Upstream closed the connection, or idle timeout |
| 1001 | Tunnel shutting down |
| 1002 | WebSocket protocol error, such as an unmasked frame |
| 1003 | Text message |
| 1008 | Bad or late ClientHello (not TLS, server name missing or different, IP literal, `encrypted_client_hello`, over 16 KiB), hourly byte limit |
| 1009 | Frame or message over `MAX_MESSAGE_BYTES` |
| 1011 | Upstream connection failed |

## Configuration

Environment variables; `0` turns off the limits marked optional, and other numbers must be positive.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listening port |
| `HOST` | `127.0.0.1` | Listening IP address |
| `ALLOW_PUBLIC_BIND` | `0` | `1` allows a non-loopback `HOST` |
| `ALLOWED_ORIGINS` | loopback | Comma-separated exact origins, such as `https://signal.example.com`. Unset allows `http://localhost`, `http://127.0.0.1` and `http://[::1]` with any port |
| `ALLOW_NO_ORIGIN` | `0` | `1` accepts requests without `Origin`, such as Node scripts |
| `UPSTREAM_PROXY` | none | `http://[user:password@]host:port` HTTP `CONNECT` proxy for upstream connections; percent-encode special characters in the credentials |
| `TRUST_PROXY` | `0` | `1` takes the client address from the rightmost `X-Forwarded-For` entry |
| `LOG_CLIENT_IPS` | `0` | `1` logs client addresses |
| `MAX_TUNNELS` | `64` | Concurrent tunnels |
| `MAX_TUNNELS_PER_IP` | `16` | Concurrent tunnels per client |
| `NEW_TUNNELS_PER_IP_PER_MINUTE` | `60` | New tunnels per client per minute, in bursts of up to that many |
| `BANDWIDTH_PER_IP` | `4194304` | Bytes per second per client, in each direction |
| `BANDWIDTH_BURST_PER_IP` | `16777216` | Bytes a client may transfer at once before `BANDWIDTH_PER_IP` applies |
| `HOURLY_BYTES_PER_IP` | off | Optional: bytes per client per hour, both directions together |
| `BAN_AFTER_VIOLATIONS` | `10` | Optional: violations within `BAN_WINDOW_SECS` that ban a client |
| `BAN_WINDOW_SECS` | `600` | Window for counting violations |
| `BAN_SECS` | `900` | Ban duration |
| `MAX_TRACKED_IPS` | `16384` | Clients with limit state; idle entries are evicted first |
| `MAX_HANDSHAKES` | `128` | Concurrent connections that have not opened a tunnel yet; more are dropped |
| `MAX_REQUEST_HEAD_BYTES` | `8192` | HTTP request head size |
| `MAX_MESSAGE_BYTES` | `262144` | WebSocket frame and message size, at least 65536 |
| `HANDSHAKE_TIMEOUT_SECS` | `10` | Time for the request head, and then for the ClientHello |
| `CONNECT_TIMEOUT_SECS` | `10` | Time for the upstream connection, including the proxy exchange |
| `IDLE_TIMEOUT_SECS` | `120` | Time without data in either direction before a tunnel closes. Signal clients send keepalives every 30 s, and Signal closes an unused provisioning socket after 90 s |

Limits apply per client: an IPv4 address or an IPv6 /64. Bandwidth limits pause reading from the
client or the upstream; nothing is buffered beyond one message. A client that exceeds its hourly
bytes loses its open tunnels with 1008 and gets 429 until the budget refills.

Violations are: malformed or oversized request heads, request head timeouts, a disallowed host or
port, a missing or foreign `Origin`, invalid WebSocket upgrades, hitting the new-tunnel rate or
hourly bytes, a bad or late ClientHello, and text, oversized or malformed WebSocket messages. A
banned client gets 429 with `Retry-After` for every tunnel request; `/health` still answers. With
`TRUST_PROXY=1`, failures that happen before the client address is known (head timeouts, malformed
heads) are not counted, so the reverse proxy itself is never banned.

The tunnel stops on `SIGTERM` or `SIGINT`: it stops accepting connections, closes open tunnels with
1001 and exits within 5 seconds.

## Deployment

Serve the tunnel on the app's origin behind the TLS reverse proxy that serves the app, so the
browser connects with `wss://` and sends the app's `Origin`. The tunnel has no TLS listener of its
own; Signal's TLS stays end to end between the browser and Signal.

```sh
HOST=127.0.0.1 PORT=8787 ALLOWED_ORIGINS=https://signal.example.com TRUST_PROXY=1 \
  proxy/target/release/telesignal-tunnel
```

nginx:

```nginx
location = /tunnel {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    # Replaces any client value, so the rightmost entry is the client
    proxy_set_header X-Forwarded-For $remote_addr;
    # The tunnel does not need the app's cookies
    proxy_set_header Cookie "";
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    proxy_buffering off;
}
```

Caddy (sets `X-Forwarded-For` to the client address itself):

```caddy
signal.example.com {
    handle /tunnel {
        reverse_proxy 127.0.0.1:8787 {
            header_up -Cookie
        }
    }
    # The app
    root * /srv/telesignal
    file_server
}
```

If the reverse proxy runs on another machine or container, bind with `HOST=0.0.0.0
ALLOW_PUBLIC_BIND=1` and make sure only the reverse proxy can reach the port: with `TRUST_PROXY=1`,
anyone who reaches the tunnel directly can pick their `X-Forwarded-For` address. Without
`TRUST_PROXY=1` behind a reverse proxy, all clients share the proxy's address, so per-client limits
and bans apply to everyone together.

The build web app reaches the tunnel at `/tunnel` on its own origin unless `SIGNAL_TUNNEL_URL` is
set at build time.

## Threat model

What the tunnel sees: client addresses, the requested Signal host, the TLS ClientHello (including
the server name and the client's supported ciphers), connection times and traffic volume. With
same-origin deployment, the browser also sends the app's cookies unless the reverse proxy strips
them. The tunnel never logs payloads, and logs client addresses only with `LOG_CLIENT_IPS=1`.

What it cannot see or change: everything inside TLS, which includes request paths, account
credentials, message envelopes and attachments. The browser pins Signal's CA, so a malicious tunnel
can drop, delay or reorder connections but cannot read or forge Signal traffic.

What it protects against:

- Use as a general relay or for domain fronting: it connects only to the allowlisted hosts on port
  443, and only relays a stream that starts with a ClientHello for the requested host.
- Server-side request forgery without `UPSTREAM_PROXY`: it resolves the host once, refuses
  non-public addresses (loopback, private, link-local, CGNAT `100.64.0.0/10`, unique-local,
  multicast, unspecified, documentation and other special-purpose ranges, and IPv4-mapped or NAT64
  forms of these) and connects to the address it checked. With `UPSTREAM_PROXY` the proxy resolves
  names, so this check does not apply.
- Use from other websites through a visitor's browser: `Origin` must match. `Origin` does not stop
  non-browser clients, which can send any value; per-client limits and bans cover those.
- Resource exhaustion: bounded request heads, handshake and idle timeouts, frame and message limits,
  bounded per-tunnel buffers, concurrent connection, tunnel and client-table limits, bandwidth and
  rate limits.

Per-client limits are only as strong as client addresses: an attacker with many addresses, such as
many IPv6 /64 prefixes, can spread load across them, and can fill the client table with bans so
that new clients get 503 until the bans expire.

## Library

```rust
use telesignal_tunnel::{
    get_allowed_host,
    limits::{LimitConfig, Limits},
    relay::{self, ClientError, ClientOutput, End, Tunnel},
    upstream::{self, UpstreamProxy},
};

let host = get_allowed_host(requested).ok_or("host not allowed")?;
let limits = Limits::new(limit_config); // `Arc<Limits>`, shared by all tunnels
let slot = limits.acquire(client_ip).map_err(|_| "limit")?;
let upstream = upstream::connect(host, proxy.as_ref()).await.map_err(|_| "connect")?;
let tunnel = Tunnel { host, slot: &slot, hello_timeout, idle_timeout };
// `client_rx`: a `Stream<Item = Result<impl AsRef<[u8]>, ClientError>> + Unpin` of client bytes;
// `client_tx`: a `Sink<ClientOutput> + Unpin` that delivers `Data` and `Finished` to the client
let end: End = relay::relay(&tunnel, &mut client_rx, &mut client_tx, upstream, shutdown).await;
```

`relay` returns once the tunnel ended; the caller then closes its transport according to `End` and
may count `end.is_violation()` with `slot.record_violation()`. `src/server/websocket.rs` is the
WebSocket adapter. The desktop app (`tauri/src/transport.rs`) builds `client_rx` from a channel fed by
an IPC command and `client_tx` from `futures_util::sink::unfold` over a Tauri `Channel`, and passes
`std::future::pending()` as `shutdown`.
