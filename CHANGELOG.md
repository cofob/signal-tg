# Changelog

All notable changes to TeleSignal are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).
How to add entries and cut a release: [docs/RELEASING.md](docs/RELEASING.md). The history of Telegram Web A, on which
TeleSignal is based, is in [docs/TELEGRAM_WEB_A_CHANGELOG.md](docs/TELEGRAM_WEB_A_CHANGELOG.md).

## [Unreleased]

The conversion of Telegram Web A into a Signal client; the plan and its status are in
[docs/signal/PLAN.md](docs/signal/PLAN.md).

### Added

- Signal linked-device engine that runs in the browser: libsignal compiled to WebAssembly, a TLS client that trusts
  only Signal's certificate authority, HTTP/2 and WebSocket resources, device linking, prekeys, envelope decryption and
  an IndexedDB store. Registration of a new account with a phone number.
- Messaging through the Signal engine: sealed sender, sender keys with group send endorsements, receipts, typing
  indicators, edits, reactions, deletes, poll votes, retry requests, message requests and blocking, view-once media,
  attachments, Note to Self, and message history transfer when linking.
- Groups v2: create, change and join groups, apply incoming changes and catch up through the group log, show group
  changes as service messages.
- Synchronization with the primary device: contacts, the storage service (read and write), read and viewed state,
  `deleteForMe`, and our own profile, username and phone number privacy; safety numbers and `signal.me` links.
- `telesignal-tunnel` (`proxy/`): a Rust WebSocket-to-TCP tunnel with a host allowlist, ClientHello and server name
  checks, per-client limits and bans. The Proxy server setting selects a tunnel at runtime.
- Desktop app (`tauri/`) for macOS, Windows and Linux with native Signal connections, a tray icon, system
  notifications and `sgnl://` links.
- Signal theme, now the default, and Signal avatar colors.
- Continuous integration and releases on GitHub Actions: checks on every push, release assets on `v*` tags (web bundle,
  tunnel binaries and container image, desktop packages, `SHA256SUMS`), Dependabot, and this changelog with its tooling.

### Changed

- The app and the page title are named TeleSignal; Saved Messages is Note to Self.
- Content Security Policy allows only the app origin and the Signal tunnel.

### Removed

- Telegram-only features without a Signal counterpart: Stars, gifts, paid reactions, media and messages, Premium, ads,
  business features, message effects, translation, language detection and remote language packs.
- Telegram push registration, web login handoff, version switches and links to Telegram hosts; `npm run check:hosts`
  fails on Telegram host names in the shipped app.

[Unreleased]: https://github.com/cofob/signal-tg/commits/master
