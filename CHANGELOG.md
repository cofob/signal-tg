# Changelog

All notable changes to TeleSignal are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).
How to add entries and cut a release: [docs/RELEASING.md](docs/RELEASING.md). The history of Telegram Web A, on which
TeleSignal is based, is in [docs/TELEGRAM_WEB_A_CHANGELOG.md](docs/TELEGRAM_WEB_A_CHANGELOG.md).

## [Unreleased]

## [0.1.0] - 2026-11-21

The conversion of Telegram Web A into a Signal client; the plan and its status are in
[docs/signal/PLAN.md](docs/signal/PLAN.md).

### Added

- Signal engine that runs in the browser: libsignal compiled to WebAssembly, a TLS client that trusts only Signal's
  certificate authority, HTTP/2 and WebSocket resources, prekeys, envelope decryption and an IndexedDB store. Linking as
  a secondary device with message history transfer, or registration of a new account with a phone number, captcha,
  Signal PIN and registration lock.
- Messaging: sealed sender, sender keys with group send endorsements, receipts, typing indicators, edits, reactions,
  deletes, polls, retry requests, message requests and blocking, view-once media, voice messages, stickers, attachments,
  long messages, disappearing messages with a default timer, and Note to Self. Links in messages are clickable and ask
  before opening a website.
- Reliable sending: messages that could not be sent after a reload or a lost connection are sent again for up to a day;
  receipts that arrive before the message are kept; a partially sent message is marked, and "Message details" shows the
  status and the reason for each recipient, with "Resend" for those who did not get it.
- Groups v2: create, change and join groups, admins and permissions, member labels, invitations by phone number and
  pending invites, ending a group, invite links, and group changes as service messages.
- Stories: viewing, replies and reactions, sending to My Story, custom lists and groups, view receipts, story settings.
- Synchronization with the primary device: contacts, the storage service (read and write), read and viewed state,
  `deleteForMe`, our profile, username and phone number privacy, privacy settings (read receipts, typing indicators,
  link previews, sealed sender indicators), notification profiles, call history, sticker packs and missing attachments
  requested from the phone.
- Linking other devices to this one when it is the primary device, and a list of linked devices.
- Safety numbers and automatic key verification through Signal's key transparency log.
- Signal links open in the app: `signal.me`, `signal.group`, `signal.art` sticker packs, `signal.tube` proxies,
  `signal.link` calls and `sgnl://` links.
- Call history, gift badge and payment notices, and chat colors from the phone (display only; calls are not
  supported).
- Several accounts in one browser, each with its own data.
- `telesignal-tunnel` (`proxy/`): a Rust WebSocket-to-TCP tunnel with a host allowlist, ClientHello and server name
  checks, per-client limits and bans. The Proxy server setting selects a tunnel at runtime, and a separate Sealed sender
  tunnel setting sends traffic without account credentials through another tunnel.
- Container image `ghcr.io/<owner>/telesignal` for `linux/amd64` and `linux/arm64` with the web app, nginx and the
  tunnel in one container: correct caching and file types, precompressed files, security headers (the app's
  Content-Security-Policy, `frame-ancestors`, `Referrer-Policy`, optional HSTS), `/tunnel` on the app's origin,
  configuration through environment variables or your own nginx config, a non-root user and a read-only root file
  system. Deployment guide in [docs/DEPLOY.md](docs/DEPLOY.md).
- Desktop app (`tauri/`) for macOS, Windows and Linux: native Signal connections, files saved to Downloads or a chosen
  folder with "Open" and "Show in folder", a warning before opening dangerous file types, notifications that open their
  chat, close to tray, launch at login, hiding window content from screenshots (macOS, Windows), a macOS menu bar,
  quick reconnection after sleep, the system context menu in text fields, and `sgnl://` links.
- Signal theme, now the default, and Signal avatar colors. UI settings are kept between sessions.
- Continuous integration and releases on GitHub Actions: checks on every push, release assets on `v*` tags (web bundle,
  tunnel binaries and container images, desktop packages, `SHA256SUMS`), Dependabot, and this changelog with its
  tooling.

### Changed

- The app and the page title are named TeleSignal; Saved Messages is Note to Self.
- When the device is unlinked or the account is registered elsewhere, the app removes this device's data and shows the
  link screen.

### Removed

- The Telegram API client (GramJS) and every Telegram-only feature: Stars, gifts, paid content, Premium, ads, business
  features, message effects, bots, mini apps and widgets, channels, forums and topics, Telegram calls, saved dialogs,
  comments, reports, saved reaction tags, translation, remote language packs and the test server.
- Telegram push registration, web login handoff, version switches and links to Telegram hosts; `npm run check:hosts`
  fails on Telegram host names in the shipped app.

### Security

- Content Security Policy allows only the app origin and the Signal tunnel, in the web app and the desktop app.
- Logging out removes all local data of the account even right after a reload, and a linked device unlinks itself on
  the server.
- Error logs mask account ids, phone numbers and keys.
- Desktop app: no shell access for the page, external links limited to web, mail and phone links, new windows blocked,
  and the TLS libraries and the updater's ZIP reader updated to versions that fix published advisories.

[Unreleased]: https://github.com/cofob/signal-tg/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cofob/signal-tg/releases/tag/v0.1.0
