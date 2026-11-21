# Deploying TeleSignal

The container image `ghcr.io/cofob/telesignal` (`linux/amd64` and `linux/arm64`) holds everything a deployment needs:
the built web app, nginx, and the tunnel (`telesignal-tunnel`, see [proxy/README.md](../proxy/README.md)) that carries the
app's connections to Signal. nginx serves the app and relays `/tunnel` to the tunnel on loopback, so the browser needs
one origin only. Signal's TLS stays end to end between the browser and Signal; neither nginx nor the tunnel reads it.
Forks publish the image under their own owner.

Releases publish the tags `<version>`, `<major>.<minor>`, `<major>` and `latest` (stable versions only), and
`sha-<commit>`. Pin a version in production.

The app needs a secure context: serve it over HTTPS, or open it at `http://localhost`. Put a TLS proxy in front of the
container for a public address, see [TLS in front](#tls-in-front).

## Run

```sh
docker run -d --name telesignal --restart unless-stopped \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/cofob/telesignal:latest
```

Open <http://localhost:8080>. For another address, set `PUBLIC_URL`: it is the origin that the tunnel accepts, so a
browser on any other origin cannot use your tunnel.

```sh
docker run -d --name telesignal --restart unless-stopped \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1:8080:8080 \
  -e PUBLIC_URL=https://signal.example.com -e ENABLE_HSTS=1 \
  ghcr.io/cofob/telesignal:latest
```

Docker Compose:

```yaml
services:
  telesignal:
    image: ghcr.io/cofob/telesignal:latest
    restart: unless-stopped
    ports:
      - 127.0.0.1:8080:8080
    environment:
      PUBLIC_URL: https://signal.example.com
      ENABLE_HSTS: '1'
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
```

The image runs as the unprivileged user `65532`, listens on port 8080 and writes only to `/tmp`: nginx keeps its
temporary files there, and the entrypoint renders its configuration there. It needs no volumes; the app keeps its data
in the browser. `HEALTHCHECK` asks `/healthz`, which nginx relays to the tunnel's `/health`, so it covers both
processes. If either process stops, the container exits, and the restart policy starts it again. `docker stop` closes
open tunnels with a WebSocket close frame, then stops nginx, within a few seconds.

Build the image from a checkout with `docker build -t telesignal .`. The web app and the tunnel are built for the build
machine and the tunnel is cross-compiled, so `docker buildx build --platform linux/amd64,linux/arm64 .` needs no
emulation except for installing the packages of the last stage.

## Settings

Environment variables. The image sets them to the defaults below.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NGINX_PORT` | `8080` | Port of nginx inside the container |
| `PUBLIC_URL` | none | The origin that users open, such as `https://signal.example.com` (no path). Fills the canonical and social metadata of the page, and is the origin that the tunnel accepts unless `ALLOWED_ORIGINS` is set. Without it the tunnel accepts only the loopback origins `http://localhost`, `http://127.0.0.1` and `http://[::1]` on any port |
| `ALLOWED_ORIGINS` | `PUBLIC_URL` | The tunnel's comma-separated list of exact origins. Set it for several addresses, such as `https://signal.example.com,https://signal.example.net` |
| `TRUSTED_PROXIES` | none | Comma-separated addresses or CIDR ranges of the proxies in front of the container, such as `172.16.0.0/12`. nginx then takes the client address from their `X-Forwarded-For`. Without it, the tunnel sees every client at the proxy's address, so its per-client limits and bans apply to all clients together |
| `ENABLE_HSTS` | `0` | `1` sends `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Turn it on only when the site is served over HTTPS for good |
| `CSP_CONNECT_SRC` | none | Extra space-separated `connect-src` sources, such as `wss://tunnel.example.com`, for a tunnel on another origin than the app. `connect-src` allows every `wss:` origin already; this is for a `ws://` tunnel. nginx adds them to the header and to the page's own `<meta>` policy |
| `NGINX_LOG_LEVEL` | `warn` | nginx `error_log` level: `debug`, `info`, `notice`, `warn`, `error`, `crit`, `alert` or `emerg` |
| `NGINX_ACCESS_LOG` | `off` | `on` writes nginx's access log, which holds client addresses, to the standard output |
| `TUNNEL_PORT` | `8787` | Port of the tunnel on the container's loopback address |

The tunnel reads its own variables from the same environment: `UPSTREAM_PROXY` (an HTTP `CONNECT` proxy to reach Signal,
such as `http://proxy.internal:3128`), `LOG_CLIENT_IPS`, `ALLOW_NO_ORIGIN`, `MAX_TUNNELS`, `MAX_TUNNELS_PER_IP`,
`NEW_TUNNELS_PER_IP_PER_MINUTE`, `BANDWIDTH_PER_IP`, `HOURLY_BYTES_PER_IP`, `BAN_AFTER_VIOLATIONS`, `IDLE_TIMEOUT_SECS`
and the others in the [configuration table](../proxy/README.md#configuration). The entrypoint fixes `HOST` (the
container's loopback address), `PORT` (`TUNNEL_PORT`) and `TRUST_PROXY` (`1`, because nginx sets `X-Forwarded-For`), and
removes `ALLOW_PUBLIC_BIND`, so an orchestrator's own `PORT` cannot collide with nginx.

The container refuses to start, with exit status 64 and a message, when a setting is invalid.

The Sealed sender proxy setting of the app names a second tunnel for the connections that carry no account
credentials (see [proxy/README.md](../proxy/README.md#separate-tunnel-for-sealed-sender)). Run it as another instance of
the tunnel-only image `ghcr.io/cofob/telesignal-tunnel` with its own `UPSTREAM_PROXY` and `ALLOWED_ORIGINS` set to the
app's origin, behind its own TLS proxy; the image of the app needs no change for it, because `connect-src` allows every
`wss:` origin.

The app finds its tunnel at `/tunnel` on its own origin. The image is built with that default, and the Proxy server
setting of the app (Data and Storage, or the link screen) still selects another tunnel at run time.

## TLS in front

The container speaks plain HTTP. Terminate TLS in front of it and forward WebSocket upgrades on `/tunnel`; the proxies
below do that by default. Set `PUBLIC_URL` to the public address, and `TRUSTED_PROXIES` to the address range of the
proxy, so that the tunnel's per-client limits apply to the real clients. Bind the published port to `127.0.0.1`, or
leave it unpublished on a shared Docker network, so that only the proxy reaches the container: nginx trusts
`X-Forwarded-For` only from `TRUSTED_PROXIES`, but the tunnel behind it trusts nginx.

Caddy, on the host:

```caddy
signal.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

with `-e PUBLIC_URL=https://signal.example.com -e TRUSTED_PROXIES=172.16.0.0/12` (the Docker bridge range, from which
a proxy on the host reaches a published port) and `-e ENABLE_HSTS=1`.

Traefik, with both in one Compose project (Traefik's entry points and certificate resolver are named `websecure` and
`letsencrypt` here):

```yaml
services:
  telesignal:
    image: ghcr.io/cofob/telesignal:latest
    restart: unless-stopped
    environment:
      PUBLIC_URL: https://signal.example.com
      TRUSTED_PROXIES: 172.16.0.0/12
      ENABLE_HSTS: '1'
    read_only: true
    tmpfs:
      - /tmp
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    labels:
      - traefik.enable=true
      - traefik.http.routers.telesignal.rule=Host(`signal.example.com`)
      - traefik.http.routers.telesignal.entrypoints=websecure
      - traefik.http.routers.telesignal.tls.certresolver=letsencrypt
      - traefik.http.services.telesignal.loadbalancer.server.port=8080
```

`TRUSTED_PROXIES` must contain the address that nginx sees the proxy at: for Compose, the subnet of the network that
they share (`docker network inspect <network>`). Use a narrower range than `172.16.0.0/12` when you know it.

## Headers

nginx sends these on every response of the app (and, for a manual config, `/tmp/telesignal/nginx/security-headers.inc`
holds them):

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | The policy of `buildCsp` in `vite.config.ts`, plus `frame-ancestors 'none'`. The image build reads the policy back from the built `index.html`, so it cannot drift from the source. A browser applies a policy from a `<meta>` tag to the page only; the header covers the Web Worker that runs the Signal engine, and carries `frame-ancestors` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin`: the app's multi-account back navigation needs the referrer of its own origin, and other sites get none |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | Turns off the sensors, USB, serial, HID, MIDI, payment, geolocation and the advertising topics APIs, which the app never uses. Camera, microphone, clipboard, fullscreen and passkeys stay available to the app |
| `Strict-Transport-Security` | With `ENABLE_HSTS=1` only |
| `Cache-Control` | `public, max-age=31536000, immutable` for files with a content hash in their name (`/assets/*-<hash>.*` and the hashed workers at the top level), a week for the emoji images, `no-cache` for everything else: `index.html`, the service worker (`service.worker-<hash>.js`), the web manifest and the other fixed names are revalidated on every use with their `ETag` |

Files are served with their types, including `application/wasm`. The build ships `.gz` and `.br` copies of the large
files, which nginx sends to clients that ask (`gzip_static`, `brotli_static`); `index.html` and small files are
compressed on the fly. A policy delivered both as a header and as a `<meta>` tag applies as the intersection of the two.

## Your own nginx configuration

`/etc/nginx/nginx.conf` of the image holds the settings of the `http` block (compression, temporary directories, MIME
types) and includes, in this order, `/etc/nginx/conf.d/*.conf` and the generated `/tmp/telesignal/nginx/*.conf`. The
entrypoint renders `/etc/nginx/templates/*.template` with `envsubst` into `/tmp/telesignal/nginx` at every start: a
`name.conf.template` becomes an included `name.conf`, and a `name.inc.template` becomes `name.inc`, which a config
includes by name.

- **Replace the server.** Mount your files at `/etc/nginx/conf.d/*.conf`. When that directory holds any `.conf` file, the
  entrypoint does not generate the server, and logs that it uses yours. Your `server` blocks listen on the port you
  choose (not `NGINX_PORT`); publish that port, and note that the health check asks `NGINX_PORT` at `/healthz`, so
  either serve `/healthz` there or override the check (`docker run --health-cmd ...`). The `.inc` files stay available:
  `include /tmp/telesignal/nginx/security-headers.inc;` adds the headers above to a `server` or `location` (the headers
  of a block that sets any `add_header` of its own replace the inherited ones, so include the file again there).
  Reach the tunnel with the `/tunnel` block of the template, at `http://127.0.0.1:8787` (`TUNNEL_PORT`).
- **Change the generated server.** Copy `docker/templates/site.conf.template` from the repository, edit it, and mount it
  at `/etc/nginx/templates/site.conf.template`. The variables the entrypoint substitutes are the settings above and the
  computed `TELESIGNAL_CSP`, `TELESIGNAL_HSTS`, `TELESIGNAL_LISTEN_IPV6`, `TELESIGNAL_ACCESS_LOG`, `TELESIGNAL_REAL_IP` and
  `TELESIGNAL_PAGE_FILTERS`; other `$` expressions stay nginx's.
- **Replace everything.** Mount a complete `/etc/nginx/nginx.conf`. The entrypoint still renders the templates, validates
  the settings, starts the tunnel and passes `error_log` and `daemon off` on the command line; the config must keep its
  files under `/tmp` and use a port above 1023.

The entrypoint checks the result with `nginx -t` before it starts anything, and exits with a message if it fails.

Writable paths: only `/tmp` (use `--read-only --tmpfs /tmp`).

## Without the image

The static files and the tunnel work separately: `npm run build:production` writes the app to `dist/`, and releases
attach it as `telesignal-web-<version>.tar.gz`. [proxy/README.md](../proxy/README.md) has the tunnel, its container
image `ghcr.io/cofob/telesignal-tunnel`, and nginx and Caddy configurations that serve the app and the headers above.
