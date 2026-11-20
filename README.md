# TeleSignal

Web client for the [Signal](https://signal.org) messenger, built on [Telegram Web A](https://github.com/Ajaxy/telegram-tt). It runs as a Signal linked device; all protocol logic and cryptography run in the browser. Work in progress: see [docs/signal/PLAN.md](docs/signal/PLAN.md).

## Setup

```sh
cp .env.example .env
npx npm@11 ci
```

Until GramJS is removed, the build needs any values for `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `.env`.

## Development

```sh
npm run signal:proxy  # WebSocket-to-TCP tunnel to Signal servers, needs Rust; see proxy/README.md
npm run dev           # http://localhost:1234
```

Regenerate after changes: `npm run signal:wasm` (libsignal WebAssembly, needs Rust) and `npm run signal:proto` (protobuf).

## License

GPL-3.0-or-later. `rust/libsignal` is [libsignal](https://github.com/signalapp/libsignal), AGPL-3.0-only.
