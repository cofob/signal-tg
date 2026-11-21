#!/usr/bin/env bash
# shellcheck disable=SC2015
# Starts the TeleSignal image the way a hardened deployment runs it (read-only root file system, no capabilities) and
# checks what the web app needs from it: the health check, the page and its headers, file types and caching, the
# compressed copies, the tunnel behind `/tunnel`, the settings and the shutdown.
#
#   docker/smoke-test.sh <image> [platform]
#
# `SMOKE_PORT` (default 18080) is the port on the host, and `SMOKE_TUNNEL_PORT` (18787) the tunnel's port inside the
# container, which only matters with `--network host`. `SMOKE_UPSTREAM_PROXY` sets the tunnel's `UPSTREAM_PROXY` for a
# machine that reaches the internet through a proxy, and `SMOKE_DOCKER_ARGS` adds `docker run` options, such as
# `--network host` to reach that proxy on the host's loopback address.
set -euo pipefail

IMAGE=${1:?Usage: smoke-test.sh <image> [platform]}
PLATFORM=${2:-}
PORT=${SMOKE_PORT:-18080}
BASE_URL="http://127.0.0.1:${PORT}"
NAME="telesignal-smoke-$$"
WORK_DIR=$(mktemp -d)
HEALTH_TIMEOUT_SECS=${SMOKE_HEALTH_TIMEOUT_SECS:-120}
WEBSOCKET_KEY=dGhlIHNhbXBsZSBub25jZQ==

failures=0

cleanup() {
  docker rm -f "$NAME" > /dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

pass() {
  echo "ok   $*"
}

fail() {
  echo "FAIL $*" >&2
  failures=$((failures + 1))
}

# Runs the image with the hardened options and the given environment, `-e NAME=value ...`
start_container() {
  docker rm -f "$NAME" > /dev/null 2>&1 || true
  local args=(--detach --name "$NAME" --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
    --publish "127.0.0.1:${PORT}:${PORT}" -e "NGINX_PORT=${PORT}" -e "TUNNEL_PORT=${SMOKE_TUNNEL_PORT:-18787}")
  [[ -n "$PLATFORM" ]] && args+=(--platform "$PLATFORM")
  [[ -n "${SMOKE_UPSTREAM_PROXY:-}" ]] && args+=(-e "UPSTREAM_PROXY=${SMOKE_UPSTREAM_PROXY}")
  # shellcheck disable=SC2206
  [[ -n "${SMOKE_DOCKER_ARGS:-}" ]] && args+=(${SMOKE_DOCKER_ARGS})
  docker run "${args[@]}" "$@" "$IMAGE" > /dev/null
}

wait_until_healthy() {
  local status
  for _ in $(seq 1 "$HEALTH_TIMEOUT_SECS"); do
    status=$(docker inspect --format '{{if .State.Running}}{{.State.Health.Status}}{{else}}exited{{end}}' "$NAME")
    case "$status" in
      healthy) return 0 ;;
      exited) return 1 ;;
    esac
    sleep 1
  done
  return 1
}

# `fetch <name> <path> [curl options]` saves the headers to `$WORK_DIR/<name>.headers` and the body to `<name>.body`,
# and prints the status code
fetch() {
  local name=$1 path=$2
  shift 2
  curl -sS --max-time 20 -D "$WORK_DIR/$name.headers" -o "$WORK_DIR/$name.body" -w '%{http_code}' "$@" "${BASE_URL}${path}"
}

# The value of a response header, lower-cased by name, without the trailing carriage return
get_header() {
  local name=$1 file=$2
  awk -v name="$(tr '[:upper:]' '[:lower:]' <<< "$name")" '
    { split_at = index($0, ": ") }
    split_at && tolower(substr($0, 1, split_at - 1)) == name { value = substr($0, split_at + 2); sub(/\r$/, "", value) }
    END { print value }' "$WORK_DIR/$file.headers"
}

expect_equal() {
  local description=$1 actual=$2 expected=$3
  if [[ "$actual" == "$expected" ]]; then pass "$description"; else fail "$description: got '$actual', expected '$expected'"; fi
}

expect_contains() {
  local description=$1 actual=$2 expected=$3
  if [[ "$actual" == *"$expected"* ]]; then pass "$description"; else fail "$description: '$actual' lacks '$expected'"; fi
}

expect_empty() {
  local description=$1 actual=$2
  if [[ -z "$actual" ]]; then pass "$description"; else fail "$description: got '$actual'"; fi
}

# The page's `<meta>` policy, read the way the image's build reads it
get_meta_policy() {
  sed -n 's/.*http-equiv="Content-Security-Policy" content="\([^"]*\)".*/\1/p' "$WORK_DIR/$1.body"
}

# An upgrade request to the tunnel; prints the status code. The upgrade (101) leaves the connection open, so the request
# ends by its timeout
request_tunnel() {
  local name=$1 origin=$2 target=$3
  curl -sS -D "$WORK_DIR/$name.headers" -o "$WORK_DIR/$name.body" --max-time "${SMOKE_TUNNEL_TIMEOUT_SECS:-6}" \
    -H "Origin: ${origin}" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H "Sec-WebSocket-Key: ${WEBSOCKET_KEY}" "${BASE_URL}${target}" > /dev/null 2>&1 || true
  awk 'NR == 1 { print $2 }' "$WORK_DIR/$name.headers"
}

check_page() {
  local status policy
  # The root page opens the default frontend (`plugins/frontends.ts`)
  expect_equal 'GET / is served' "$(fetch root /)" 200
  expect_contains 'GET / opens a frontend' "$(cat "$WORK_DIR/root.body")" 'http-equiv="refresh"'
  expect_equal 'Web K is served' "$(fetch page_k /k/ -H 'Accept-Encoding: identity')" 200
  expect_contains 'Web K is the app' "$(cat "$WORK_DIR/page_k.body")" '<div id="main-columns"'
  status=$(fetch page /a/ -H 'Accept-Encoding: identity')
  expect_equal 'GET /a/ is served' "$status" 200
  expect_contains 'page content type' "$(get_header content-type page)" 'text/html'
  expect_contains 'page cache' "$(get_header cache-control page)" 'no-cache'
  expect_contains 'page is the app' "$(cat "$WORK_DIR/page.body")" '<div id="portals">'

  local csp
  csp=$(get_header content-security-policy page)
  expect_contains 'CSP header' "$csp" "default-src 'self'"
  expect_contains 'CSP forbids framing' "$csp" "frame-ancestors 'none'"
  policy=$(get_meta_policy page)
  # The header is the page's own policy plus `frame-ancestors`
  expect_equal 'CSP header extends the page policy' "$csp" "${policy%;}; frame-ancestors 'none'"
  expect_empty 'CSP header has no empty directive' "$(grep -F ';;' <<< "$csp" || true)"
  expect_equal 'X-Content-Type-Options' "$(get_header x-content-type-options page)" nosniff
  expect_equal 'Referrer-Policy' "$(get_header referrer-policy page)" same-origin
  expect_equal 'X-Frame-Options' "$(get_header x-frame-options page)" DENY
  expect_contains 'Permissions-Policy' "$(get_header permissions-policy page)" 'geolocation=()'
  expect_empty 'no HSTS by default' "$(get_header strict-transport-security page)"
  expect_empty 'no server version' "$(get_header server page | grep -E '[0-9]' || true)"

  expect_equal 'missing files are 404' "$(fetch missing /a/assets/missing-12345678.js)" 404
  expect_contains '404 keeps the headers' "$(get_header x-content-type-options missing)" nosniff
}

# The first file of the built app that matches a glob, as a path on the site
find_asset() {
  docker exec "$NAME" sh -c "cd /srv/telesignal && ls a/$1 2> /dev/null | head -1"
}

check_assets() {
  local wasm worker script status
  wasm=$(find_asset 'assets/signal_wasm_bg-*.wasm')
  if [[ -z "$wasm" ]]; then
    fail 'the Signal WebAssembly module is not in the image'
    return
  fi
  status=$(fetch wasm "/${wasm}" -H 'Accept-Encoding: identity')
  expect_equal 'wasm is served' "$status" 200
  expect_equal 'wasm content type' "$(get_header content-type wasm)" application/wasm
  expect_contains 'hashed files are immutable' "$(get_header cache-control wasm)" 'immutable'
  expect_contains 'files carry the policy too' "$(get_header content-security-policy wasm)" "frame-ancestors 'none'"

  fetch wasm_br "/${wasm}" -H 'Accept-Encoding: br, gzip' > /dev/null
  expect_equal 'wasm is sent with brotli' "$(get_header content-encoding wasm_br)" br
  fetch wasm_gzip "/${wasm}" -H 'Accept-Encoding: gzip' > /dev/null
  expect_equal 'wasm is sent with gzip' "$(get_header content-encoding wasm_gzip)" gzip

  script=$(find_asset 'assets/*.js')
  fetch js "/${script}" -H 'Accept-Encoding: identity' > /dev/null
  expect_contains 'script content type' "$(get_header content-type js)" 'javascript'

  fetch manifest /a/site.webmanifest > /dev/null
  expect_contains 'manifest content type' "$(get_header content-type manifest)" 'application/manifest+json'
  expect_contains 'manifest is revalidated' "$(get_header cache-control manifest)" 'no-cache'

  # Hashed worker bundles at the top level are immutable; the service worker, which has a hashed name too, is not
  worker=$(docker exec "$NAME" sh -c 'cd /srv/telesignal && ls -- a/*worker-*.js 2> /dev/null | grep -v service | head -1')
  if [[ -n "$worker" ]]; then
    fetch worker "/${worker}" > /dev/null
    expect_contains "worker bundle (${worker}) cache" "$(get_header cache-control worker)" 'immutable'
  else
    fail 'no worker bundle at the top level of the app'
  fi
  service_worker=$(docker exec "$NAME" sh -c 'cd /srv/telesignal && ls -- a/*service.worker-*.js a/assets/*service.worker-*.js 2> /dev/null | head -1')
  if [[ -n "$service_worker" ]]; then
    fetch service_worker "/${service_worker}" > /dev/null
    expect_equal "service worker (${service_worker}) cache" "$(get_header cache-control service_worker)" no-cache
  else
    fail 'the service worker is not in the image'
  fi

  # Fixed names that the app regenerates must never be cached for long
  for snapshot in skeleton-snapshot.css wallpaper-snapshot.css; do
    expect_equal "${snapshot} is served" "$(fetch snapshot "/a/${snapshot}")" 200
    expect_equal "${snapshot} cache" "$(get_header cache-control snapshot)" no-cache
  done

  local etag
  etag=$(get_header etag page)
  expect_equal 'conditional request for the page' "$(fetch conditional /a/ -H "If-None-Match: ${etag}")" 304
}

check_tunnel() {
  expect_equal 'tunnel refuses a foreign origin' \
    "$(request_tunnel foreign https://evil.example '/tunnel?host=chat.signal.org&port=443')" 403
  expect_equal 'tunnel refuses other hosts' \
    "$(request_tunnel host "http://localhost:${PORT}" '/tunnel?host=example.com&port=443')" 403
  expect_equal 'tunnel needs the upgrade' "$(fetch plain '/tunnel?host=chat.signal.org&port=443' -H "Origin: http://localhost:${PORT}")" 400
  expect_equal 'tunnel health' "$(fetch health /healthz)" 200
  expect_equal 'tunnel health body' "$(cat "$WORK_DIR/health.body")" ok

  check_upgrade 'WebSocket upgrade to chat.signal.org' "http://localhost:${PORT}"
}

# The upgrade of an allowed origin to a Signal host. The tunnel connects upstream before it answers, so a runner that
# cannot reach Signal gets 502 or 504, which says nothing about the image
check_upgrade() {
  local description=$1 origin=$2 status
  status=$(request_tunnel upgrade "$origin" '/tunnel?host=chat.signal.org&port=443')
  case "$status" in
    101) pass "$description" ;;
    502 | 504) echo "warn ${description}: the tunnel could not reach chat.signal.org from here (HTTP ${status})" ;;
    *) fail "${description}: HTTP ${status}" ;;
  esac
}

check_runtime() {
  expect_equal 'runs as an unprivileged user' "$(docker exec "$NAME" id -u)" 65532
  expect_equal 'root file system is read-only' \
    "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$NAME")" true
  docker exec "$NAME" pidof telesignal-tunnel > /dev/null && pass 'the tunnel runs' || fail 'the tunnel is not running'
  docker exec "$NAME" pidof nginx > /dev/null && pass 'nginx runs' || fail 'nginx is not running'
}

# Stopping the container shuts both processes down in order and exits 0 within the stop timeout
check_shutdown() {
  local started status
  started=$(date +%s)
  docker stop --time 20 "$NAME" > /dev/null
  status=$(docker inspect --format '{{.State.ExitCode}}' "$NAME")
  expect_equal 'graceful stop exits 0' "$status" 0
  if (($(date +%s) - started > 8)); then fail "stopping took $(($(date +%s) - started)) s"; else pass 'stops within 8 s'; fi
}

# If either process dies, the container exits
check_supervision() {
  start_container
  wait_until_healthy || { fail 'supervision: not healthy'; return; }
  docker exec "$NAME" sh -c 'kill -KILL "$(pidof telesignal-tunnel)"'
  local state=
  for _ in $(seq 1 20); do
    state=$(docker inspect --format '{{.State.Status}}' "$NAME")
    [[ "$state" == exited ]] && break
    sleep 1
  done
  expect_equal 'container exits when the tunnel dies' "$state" exited
  [[ "$(docker inspect --format '{{.State.ExitCode}}' "$NAME")" != 0 ]] && pass 'exit status is not 0' || fail 'exit status is 0'
}

check_settings() {
  local policy status
  start_container -e PUBLIC_URL=HTTPS://Signal.Example.Test:443/ -e ENABLE_HSTS=1 \
    -e CSP_CONNECT_SRC='wss://tunnel.example.test' -e NGINX_ACCESS_LOG=on
  wait_until_healthy || { fail 'settings: not healthy'; return; }
  status=$(fetch page /a/ -H 'Accept-Encoding: identity')
  expect_equal 'GET /a/ with settings' "$status" 200
  expect_contains 'HSTS header' "$(get_header strict-transport-security page)" 'max-age=63072000'
  expect_contains 'CSP header has the extra source' "$(get_header content-security-policy page)" "connect-src 'self' wss://tunnel.example.test"
  policy=$(get_meta_policy page)
  expect_contains 'the page policy has the extra source too' "$policy" "connect-src 'self' wss://tunnel.example.test"
  expect_equal 'CSP header extends the page policy' "$(get_header content-security-policy page)" "${policy%;}; frame-ancestors 'none'"
  grep -q 'rel="canonical" href="https://signal.example.test/"' "$WORK_DIR/page.body" \
    && pass 'the page names its public address' || fail 'the page keeps the default public address'
  expect_empty 'the default address is gone' "$(grep -c 'http://localhost:1234/' "$WORK_DIR/page.body" | grep -v '^0$' || true)"
  # `PUBLIC_URL` is the tunnel's origin: the loopback origin is refused and the public one is accepted
  check_upgrade 'tunnel accepts the public origin' https://signal.example.test
  expect_equal 'tunnel refuses the loopback origin' \
    "$(request_tunnel loopback "http://localhost:${PORT}" '/tunnel?host=chat.signal.org&port=443')" 403
  expect_equal 'the compressed page is served' "$(fetch gz /a/ -H 'Accept-Encoding: gzip')" 200
  expect_equal 'the page is compressed on the fly' "$(get_header content-encoding gz)" gzip
}

check_bad_settings() {
  local code
  local settings=(NGINX_PORT=70000 'PUBLIC_URL=signal.example.test' 'PUBLIC_URL=https://signal.example.test:99999'
    'PUBLIC_URL=https://signal.example.test/path' 'CSP_CONNECT_SRC=a;b' 'NGINX_LOG_LEVEL=loud' 'TRUSTED_PROXIES=nope'
    $'PUBLIC_URL=https://signal.example.test\nhttps://evil.example'
    $'CSP_CONNECT_SRC=wss://tunnel.example.test\nscript-src *'
    $'TRUSTED_PROXIES=10.0.0.0/8\n0.0.0.0/0')
  for setting in "${settings[@]}"; do
    docker rm -f "$NAME" > /dev/null 2>&1 || true
    code=0
    docker run --name "$NAME" ${PLATFORM:+--platform "$PLATFORM"} --read-only --tmpfs /tmp -e "$setting" "$IMAGE" > /dev/null 2>&1 || code=$?
    expect_equal "bad ${setting%%=*} (${setting//$'\n'/\\n}) stops the container" "$code" 64
  done
}

check_manual_config() {
  # A config of your own in `/etc/nginx/conf.d` replaces the generated server
  printf 'server {\n  listen %s;\n  location = /healthz { return 200 "custom\\n"; }\n  location / { return 204; }\n}\n' "$PORT" \
    > "$WORK_DIR/custom.conf"
  chmod 644 "$WORK_DIR/custom.conf"
  start_container -v "$WORK_DIR/custom.conf:/etc/nginx/conf.d/custom.conf:ro"
  for _ in $(seq 1 30); do
    [[ "$(fetch custom /healthz 2> /dev/null || true)" == 200 ]] && break
    sleep 1
  done
  expect_equal 'custom config is served' "$(cat "$WORK_DIR/custom.body")" custom
  expect_equal 'custom config replaces the generated server' "$(fetch custom_root / || true)" 204
}

main() {
  echo "Testing ${IMAGE} ${PLATFORM}"
  start_container
  if ! wait_until_healthy; then
    docker logs "$NAME" || true
    echo 'The container did not become healthy' >&2
    exit 1
  fi
  check_runtime
  check_page
  check_assets
  check_tunnel
  check_shutdown

  check_settings
  docker rm -f "$NAME" > /dev/null
  check_bad_settings
  check_manual_config
  docker rm -f "$NAME" > /dev/null
  check_supervision

  if ((failures > 0)); then
    docker logs "$NAME" 2>&1 | tail -30 || true
    echo "${failures} check(s) failed" >&2
    exit 1
  fi
  echo 'All checks passed'
}

main
