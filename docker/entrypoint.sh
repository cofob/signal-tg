#!/bin/sh
# shellcheck disable=SC2089,SC2090 # The `TELESIGNAL_` snippets are nginx text for `envsubst`, never commands
# Entrypoint of the TeleSignal image: checks the settings, renders the nginx configuration from its templates, and runs
# nginx and the tunnel until either stops or the container gets SIGTERM. Settings: docs/DEPLOY.md.
set -eu

TEMPLATES_DIR=/etc/nginx/templates
USER_CONF_DIR=/etc/nginx/conf.d
RUN_DIR=/tmp/telesignal
CONF_DIR=$RUN_DIR/nginx
CSP_FILE=/usr/share/telesignal/csp.txt
HSTS_VALUE='max-age=63072000; includeSubDomains'
# Names that the templates may use; other `$` expressions in them belong to nginx
# shellcheck disable=SC2016
TEMPLATE_VARIABLES='${NGINX_PORT} ${TUNNEL_PORT} ${TELESIGNAL_CSP} ${TELESIGNAL_HSTS} ${TELESIGNAL_LISTEN_IPV6} ${TELESIGNAL_ACCESS_LOG} ${TELESIGNAL_REAL_IP} ${TELESIGNAL_PAGE_FILTERS}'

log() {
    echo "telesignal: $*" >&2
}

fail() {
    log "$*"
    exit 64
}

is_true() {
    case "$1" in
        1 | true | TRUE | True | yes | on) return 0 ;;
        *) return 1 ;;
    esac
}

is_port() {
    case "$1" in
        '' | *[!0-9]*) return 1 ;;
    esac
    [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

check_settings() {
    : "${NGINX_PORT:=8080}"
    : "${TUNNEL_PORT:=8787}"
    : "${NGINX_LOG_LEVEL:=warn}"
    : "${NGINX_ACCESS_LOG:=off}"
    : "${ENABLE_HSTS:=0}"
    : "${PUBLIC_URL:=}"
    : "${CSP_CONNECT_SRC:=}"
    : "${TRUSTED_PROXIES:=}"

    is_port "$NGINX_PORT" || fail "NGINX_PORT must be a port number, got '$NGINX_PORT'"
    is_port "$TUNNEL_PORT" || fail "TUNNEL_PORT must be a port number, got '$TUNNEL_PORT'"
    [ "$NGINX_PORT" != "$TUNNEL_PORT" ] || fail 'NGINX_PORT and TUNNEL_PORT must differ'
    case "$NGINX_LOG_LEVEL" in
        debug | info | notice | warn | error | crit | alert | emerg) ;;
        *) fail "NGINX_LOG_LEVEL must be debug, info, notice, warn, error, crit, alert or emerg, got '$NGINX_LOG_LEVEL'" ;;
    esac
    case "$NGINX_ACCESS_LOG" in
        on | off) ;;
        *) fail "NGINX_ACCESS_LOG must be on or off, got '$NGINX_ACCESS_LOG'" ;;
    esac
    export NGINX_PORT TUNNEL_PORT
}

# `PUBLIC_URL` is the address that users open. It fills the page's canonical and social metadata, and it is the origin
# that the tunnel accepts unless `ALLOWED_ORIGINS` says otherwise.
check_public_url() {
    PUBLIC_ORIGIN=
    [ -n "$PUBLIC_URL" ] || return 0
    printf '%s' "$PUBLIC_URL" | grep -Eq '^https?://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?/?$' \
        || fail "PUBLIC_URL must be an origin such as https://signal.example.com, got '$PUBLIC_URL'"
    PUBLIC_ORIGIN=${PUBLIC_URL%/}
}

# Sources for `connect-src`, for a tunnel on another origin than the app. The page's own `<meta>` tag carries the same
# policy, and a browser applies both, so nginx edits the tag in the page it serves.
build_csp() {
    base_csp=$(cat "$CSP_FILE")
    TELESIGNAL_CSP=$base_csp
    if [ -n "$CSP_CONNECT_SRC" ]; then
        printf '%s' "$CSP_CONNECT_SRC" | grep -Eq "^[A-Za-z0-9:/._*@ -]+\$" \
            || fail 'CSP_CONNECT_SRC takes space-separated sources, such as "wss://tunnel.example.com", without quotes'
        TELESIGNAL_CSP=$(printf '%s' "$base_csp" | sed "s|connect-src 'self'|connect-src 'self' $CSP_CONNECT_SRC|")
        [ "$TELESIGNAL_CSP" != "$base_csp" ] || fail "$CSP_FILE has no connect-src 'self'"
    fi
}

# Replaces the page's policy and its default address in `index.html` on the fly; the file itself stays untouched
build_page_filters() {
    TELESIGNAL_PAGE_FILTERS=
    if [ "$TELESIGNAL_CSP" != "$base_csp" ]; then
        TELESIGNAL_PAGE_FILTERS="        sub_filter \"$base_csp\" \"$TELESIGNAL_CSP\";"
    fi
    if [ -n "$PUBLIC_ORIGIN" ]; then
        # The default of `BASE_URL` in `vite.config.ts`
        TELESIGNAL_PAGE_FILTERS="$TELESIGNAL_PAGE_FILTERS
        sub_filter \"http://localhost:1234/\" \"$PUBLIC_ORIGIN/\";"
    fi
    if [ -n "$TELESIGNAL_PAGE_FILTERS" ]; then
        TELESIGNAL_PAGE_FILTERS="$TELESIGNAL_PAGE_FILTERS
        sub_filter_once off;"
    fi
}

# Behind a TLS proxy every request comes from the proxy's address; the tunnel's per-client limits need the real one
build_real_ip() {
    TELESIGNAL_REAL_IP=
    [ -n "$TRUSTED_PROXIES" ] || return 0
    for proxy in $(printf '%s' "$TRUSTED_PROXIES" | tr ',' ' '); do
        printf '%s' "$proxy" | grep -Eq '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$' \
            || fail "TRUSTED_PROXIES takes comma-separated addresses or CIDR ranges, got '$proxy'"
        TELESIGNAL_REAL_IP="$TELESIGNAL_REAL_IP
    set_real_ip_from $proxy;"
    done
    TELESIGNAL_REAL_IP="$TELESIGNAL_REAL_IP
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;"
}

build_snippets() {
    build_csp
    build_page_filters
    build_real_ip
    TELESIGNAL_HSTS=
    if is_true "$ENABLE_HSTS"; then
        TELESIGNAL_HSTS="add_header Strict-Transport-Security \"$HSTS_VALUE\" always;"
    fi
    TELESIGNAL_LISTEN_IPV6=
    # A container without IPv6 would refuse the listener
    if [ -e /proc/net/if_inet6 ]; then
        TELESIGNAL_LISTEN_IPV6="    listen [::]:$NGINX_PORT default_server;"
    fi
    TELESIGNAL_ACCESS_LOG=off
    if [ "$NGINX_ACCESS_LOG" = on ]; then
        TELESIGNAL_ACCESS_LOG=/dev/stdout
    fi
    export TELESIGNAL_CSP TELESIGNAL_HSTS TELESIGNAL_LISTEN_IPV6 TELESIGNAL_ACCESS_LOG TELESIGNAL_REAL_IP \
        TELESIGNAL_PAGE_FILTERS
}

# `*.conf.template` becomes an included `*.conf`; `*.inc.template` becomes a file that a config includes by name. A
# config of your own in `/etc/nginx/conf.d` is in charge of the servers, so the `*.conf` templates are skipped then.
render_templates() {
    mkdir -p "$CONF_DIR" /tmp/nginx
    rm -f "$CONF_DIR"/*
    has_user_conf=false
    for file in "$USER_CONF_DIR"/*.conf; do
        [ -e "$file" ] && has_user_conf=true
    done
    if [ "$has_user_conf" = true ]; then
        log "using the config in $USER_CONF_DIR instead of the generated server"
    fi

    for template in "$TEMPLATES_DIR"/*.template; do
        [ -e "$template" ] || continue
        name=$(basename "$template" .template)
        case "$name" in
            *.conf) [ "$has_user_conf" = true ] && continue ;;
        esac
        envsubst "$TEMPLATE_VARIABLES" < "$template" > "$CONF_DIR/$name"
    done

    if ! output=$(nginx -e stderr -t -g "error_log stderr $NGINX_LOG_LEVEL;" 2>&1); then
        echo "$output" >&2
        fail 'the nginx configuration is invalid'
    fi
}

# The tunnel listens on loopback only, behind nginx, whose `X-Forwarded-For` it trusts. `HOST`, `PORT` and
# `TRUST_PROXY` are fixed here (an orchestrator's `PORT` would otherwise collide with nginx); the tunnel reads every
# other variable of its own (`proxy/README.md`) from the container environment.
prepare_tunnel() {
    export HOST=127.0.0.1 PORT="$TUNNEL_PORT" TRUST_PROXY=1
    unset ALLOW_PUBLIC_BIND
    if [ -z "${ALLOWED_ORIGINS:-}" ] && [ -n "$PUBLIC_ORIGIN" ]; then
        export ALLOWED_ORIGINS="$PUBLIC_ORIGIN"
    fi
}

# The tunnel closes its open tunnels with 1001 and exits within 5 seconds; nginx relays those frames, so it stops after
# the tunnel and then finishes its remaining requests
stop_services() {
    kill -TERM "$tunnel_pid" 2> /dev/null || true
    wait "$tunnel_pid" 2> /dev/null || true
    kill -QUIT "$nginx_pid" 2> /dev/null || true
    wait "$nginx_pid" 2> /dev/null || true
}

# shellcheck disable=SC2329
request_stop() {
    stop_requested=true
}

run_services() {
    stop_requested=false
    trap request_stop TERM INT QUIT HUP

    telesignal-tunnel &
    tunnel_pid=$!
    nginx -e stderr -g "daemon off; error_log stderr $NGINX_LOG_LEVEL;" &
    nginx_pid=$!
    log "serving on port $NGINX_PORT, tunnel on 127.0.0.1:$TUNNEL_PORT"

    # `wait` returns at once when a trapped signal arrives
    while [ "$stop_requested" = false ] && kill -0 "$tunnel_pid" 2> /dev/null && kill -0 "$nginx_pid" 2> /dev/null; do
        sleep 1 &
        wait $! || true
    done

    if [ "$stop_requested" = true ]; then
        stop_services
        exit 0
    fi

    # One process ended on its own: report it, stop the other and fail so that the container restarts
    status=1
    if ! kill -0 "$tunnel_pid" 2> /dev/null; then
        wait "$tunnel_pid" && status=0 || status=$?
        log "the tunnel exited with status $status"
    else
        wait "$nginx_pid" && status=0 || status=$?
        log "nginx exited with status $status"
    fi
    stop_services
    [ "$status" -ne 0 ] || status=1
    exit "$status"
}

main() {
    check_settings
    check_public_url
    build_snippets
    render_templates
    prepare_tunnel
    run_services
}

main
