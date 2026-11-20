# TeleSignal tunnel

`tunnel.ts` lets the browser reach Signal servers. It accepts WebSocket connections at
`/tunnel?host=<host>&port=443` and relays raw TCP bytes to the allowlisted Signal hosts. The browser
runs TLS inside WebAssembly and trusts only Signal's certificate authority, so the tunnel sees host
names and traffic volume but not request contents or credentials.

Run it with Node 24 and no dependencies:

```sh
npm run signal:proxy
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listening port |
| `HOST` | `127.0.0.1` | Listening address |
| `ALLOWED_ORIGINS` | any | Comma-separated origins allowed to open tunnels |
| `UPSTREAM_PROXY` | none | `http://host:port` HTTP CONNECT proxy for outbound connections |
| `MAX_TUNNELS` | `64` | Concurrent tunnel limit |

In production, serve it behind the reverse proxy that serves the app, on the same origin, and set
`ALLOWED_ORIGINS` to that origin so other sites cannot use it. `GET /health` returns `ok`.
