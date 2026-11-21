# TeleSignal

Web client for the [Signal](https://signal.org) messenger, built on [Telegram Web A](https://github.com/Ajaxy/telegram-tt). It runs as a Signal linked device; all protocol logic and cryptography run in the browser. Work in progress: see [docs/signal/PLAN.md](docs/signal/PLAN.md).

## Screenshots

The screenshots show demo data (`signalDev.seedDemo()` in development builds).

![Group chat with a poll and delivery states, light theme](docs/screenshots/light-group.png)

![Direct chat with photos, a sticker and service messages, dark theme](docs/screenshots/dark-chat.png)

![Story viewer, dark theme](docs/screenshots/dark-story.png)

## Setup

```sh
cp .env.example .env
npx npm@11 ci
```

## Development

```sh
npm run signal:proxy  # WebSocket-to-TCP tunnel to Signal servers, needs Rust; see proxy/README.md
npm run dev           # http://localhost:1234
```

Regenerate after changes: `npm run signal:wasm` (libsignal WebAssembly, needs Rust) and `npm run signal:proto` (protobuf).

## Deployment

```sh
docker run -d -p 127.0.0.1:8080:8080 --read-only --tmpfs /tmp ghcr.io/cofob/telesignal:latest
```

The image holds the web app, nginx and the tunnel to Signal servers. Settings, TLS in front, security headers and your own nginx configuration: [docs/DEPLOY.md](docs/DEPLOY.md).

## Desktop app

`tauri/` builds TeleSignal for macOS, Windows and Linux; it reaches Signal servers without the tunnel. See [tauri/README.md](tauri/README.md).

## Checks and releases

GitHub Actions checks every push; `npm run check` runs the web checks locally. Tags `v*` publish releases with the web bundle, the tunnel, the container images and the desktop packages. Changes that users notice go to [CHANGELOG.md](CHANGELOG.md); see [docs/RELEASING.md](docs/RELEASING.md).

## License

GPL-3.0-or-later. `rust/libsignal` is [libsignal](https://github.com/signalapp/libsignal), AGPL-3.0-only.
