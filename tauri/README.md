# TeleSignal desktop app

The desktop app wraps the TeleSignal web app in [Tauri 2](https://v2.tauri.app) for macOS, Windows and
Linux. It bundles the web app, so it loads no remote code, and it reaches Signal servers through native
TCP connections instead of the WebSocket tunnel (`proxy/`). The Signal engine and TLS still run in the
page's worker, in WebAssembly.

- Closing the window hides it; the engine keeps running, and the tray icon or a second launch shows the
  window again. The tray menu quits the app. The unread count appears on the tray icon, the Dock icon
  (macOS), the taskbar button (Windows) and the launcher icon (Linux desktops with the Unity launcher API).
- New messages show system notifications through the Tauri notification plugin when the window is not
  focused and web notifications are on in Settings, Notifications.
- `sgnl://` links open the app and the page handles them like the links in messages (`src/util/signalLinks.ts`):
  `signal.me` (username and phone number), `signal.group` and `joingroup` (group), `addstickers` (sticker pack),
  `signal.tube` (proxy), `signal.link` (call), `linkdevice` and `rereg`. The app forwards only these hosts, so
  another `sgnl://` link, such as the ones Signal Desktop sends between its own windows, does not bring the
  window forward. A link waits in the app until the page takes it with `take_deep_links`: the one that
  launches the app (the command line on Windows and Linux, the open event on macOS), one that arrives while the
  page loads or shows the link screen, and one from a second launch all reach the page, in order, after it is
  ready. At most 8 wait, the oldest dropped first. Signal Desktop registers `sgnl` too, so the system may hand the
  links to it when both are installed. The app handles `tg:` links from its own pages internally and never passes
  them to the system.
- The updater is off unless a build configures it; see [Releases](#releases).

## Building

Requirements on every system: Rust 1.97 or newer ([rustup](https://rustup.rs)), Node.js and npm as in
`package.json` `engines`, and `npm ci` in the repository root. Until GramJS is removed, the web build
needs any values for `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in `.env` or the environment.

```sh
npm run tauri:build                                  # this system's default bundles
npm run tauri:build -- --bundles deb,appimage        # only some bundles
npm run tauri:build -- --target x86_64-apple-darwin  # an Intel build on Apple silicon
```

`tauri:build` runs `npm run build:tauri`, which builds the web app into `tauri/dist`, then compiles the
app and writes the packages to `tauri/target/release/bundle/` (`target/<target>/release/bundle/` with
`--target`).

### macOS

Xcode or its command line tools (`xcode-select --install`). Bundles: `app` and `dmg`. For an Intel build
on Apple silicon, `rustup target add x86_64-apple-darwin` first.

### Windows

Microsoft C++ Build Tools with "Desktop development with C++" and the WebView2 runtime, which Windows 10
and 11 include. Bundle: `nsis`.

### Linux

Bundles: `deb` and `appimage`. Building the AppImage downloads `linuxdeploy` from GitHub.

Debian and Ubuntu (22.04 or newer):

```sh
sudo apt-get install build-essential curl file patchelf \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
```

Nix (not tested by the maintainers):

```sh
nix-shell -p cargo rustc nodejs pkg-config gobject-introspection \
  webkitgtk_4_1 gtk3 libsoup_3 librsvg libayatana-appindicator openssl glib-networking
```

The app needs `libayatana-appindicator` (or `libappindicator`) at runtime for the tray icon; the `deb`
package depends on WebKitGTK 4.1.

## Development

```sh
npm run tauri:dev
```

This starts `npm run dev` and opens the app on `http://localhost:1234` with hot reload. If the dev server
already runs, skip starting another one:

```sh
npx tauri dev --config '{"build":{"beforeDevCommand":""}}'
```

Rust checks, in `tauri/`: `cargo clippy --all-targets -- -D warnings` and `cargo test`. They need
`tauri/dist` to exist: run `npm run build:tauri` once, or create the empty directory. The tests that
connect to Signal are ignored by default; run them with `cargo test -- --include-ignored`, adding
`UPSTREAM_PROXY=http://host:port` where outbound traffic needs an HTTP proxy.

## Native transport

`src/lib/signal/net/TlsTunnel.ts` runs TLS in WebAssembly over a byte transport: the WebSocket tunnel in
the browser, and in the app the native transport, unless the Proxy server setting (Data and Storage)
names a tunnel. The commands in `src/transport.rs` open the connections:

| Command | Purpose |
| --- | --- |
| `signal_connect(host, onEvent)` | Opens a TCP connection to `host:443` and returns its ID. `onEvent`, a Tauri `Channel`, receives the upstream bytes as `ArrayBuffer`s and then `{ closed: reason }` once |
| `signal_send` | Sends the raw request body (at most 64 KiB) on the connection named by the `signal-connection` header. Resolves once the bytes are queued |
| `signal_ack(id, byteLength)` | Acknowledges received bytes, so the app delivers more |
| `signal_close(id)` | Closes the connection |

The engine runs in a web worker, where Tauri's `invoke` and `Channel` do not exist: Tauri injects them
into the page only. The page therefore serves the transport to the worker
(`src/util/tauri/serveNativeTransport.ts`) over a `MessagePort` that it hands to the worker before the
API starts (`src/api/gramjs/worker/connector.ts`). Buffers move between the threads without copies. The
page runs one `signal_send` at a time per connection, which keeps the order of the bytes; the worker
counts the bytes it posted and not yet sent as `bufferedAmount`, which uploads wait on.

Buffers are bounded in both directions. A connection queues at most four 64 KiB chunks for the
upstream; `signal_send` waits while the queue is full. The app delivers at most 1 MiB that the worker has
not acknowledged; the worker acknowledges after TLS processed the bytes, in batches of 256 KiB, and the
app stops reading from the server while the window is full.

### Security model

The commands reuse the policy of the WebSocket tunnel from `proxy/src/lib.rs`:

- Hosts: only the allowlist (`ALLOWED_HOSTS`: `chat`, `storage`, `cdn`, `cdn2`, `cdn3`, `cdsi`,
  `contentproxy`, `sfu.voip` and `svr2` `.signal.org`) on port 443.
- Addresses: the app resolves the name once, refuses non-public addresses (loopback, private,
  link-local, CGNAT and other special-purpose ranges) and connects to the address it checked. A
  hostile DNS server therefore cannot point the app at the local network.
- First bytes: a TLS ClientHello whose only server name is the requested host and that has no
  `encrypted_client_hello`, within 10 seconds; otherwise the connection closes. So the commands carry
  only TLS to Signal hosts and cannot serve as a general TCP client.
- TLS ends in the page's WebAssembly, which trusts only Signal's certificate authority. The Rust side
  sees only the server name and encrypted bytes, and never logs payloads.
- Limits: 32 open connections, 120 new connections per minute, 10 seconds to connect, 120 seconds
  idle. A page reload or a closed window ends the connections that page opened.

Only the app's own page can call the commands: the capability in `capabilities/default.json` is
`local`, the app serves its bundled frontend (`tauri://localhost`, `http://tauri.localhost` on
Windows), navigation stays on that page, and other links open in the system browser. The CSP
(`buildCsp` in `vite.config.ts`) allows `ipc:` and `http://ipc.localhost` for Tauri's IPC.

A tunnel named in the Proxy server setting sees the app's page as the origin `tauri://localhost`
(`http://tauri.localhost` on Windows), so its `ALLOWED_ORIGINS` must list those (`proxy/README.md`).

`UPSTREAM_PROXY=http://[user:password@]host:port` in the app's environment sends the connections
through an HTTP `CONNECT` proxy, as for the tunnel. The proxy then resolves names, so the address check
does not apply.

## Releases

`.github/workflows/desktop.yml` builds on `v*` tags and on manual runs:

| Runner | Target | Packages |
| --- | --- | --- |
| `macos-latest` | `aarch64-apple-darwin` | `.dmg`, `.app.tar.gz` |
| `macos-latest` | `x86_64-apple-darwin` | `.dmg`, `.app.tar.gz` |
| `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.deb`, `.AppImage` |

Each job uploads its packages as a workflow artifact. Tag builds also attach them to a draft GitHub
release, which a maintainer publishes. The app version comes from `package.json`.

Signing and the updater are off unless these exist in the repository settings:

| Name | Kind | Purpose |
| --- | --- | --- |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Secret | Base64 `.p12` Developer ID Application certificate and its password. Without them, macOS builds are signed ad hoc and Gatekeeper asks users to confirm the first launch |
| `APPLE_SIGNING_IDENTITY` | Secret | The certificate's name, such as `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Secret | Notarization: Apple ID, app-specific password and team ID |
| `SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`, `KEYPAIR_ALIAS` | Secret | Windows signing with DigiCert KeyLocker (`smctl`); `SM_API_KEY` turns it on |
| `UPDATER_ENDPOINT` | Variable | URL of the update manifest, such as `https://github.com/<owner>/<repo>/releases/latest/download/latest.json` |
| `UPDATER_PUBLIC_KEY` | Variable | Public key from `npx tauri signer generate` |
| `UPDATER_PRIVATE_KEY`, `UPDATER_PRIVATE_KEY_PASSWORD` | Secret | The matching private key and its password, which sign the update packages |

The updater needs all of `UPDATER_ENDPOINT`, `UPDATER_PUBLIC_KEY` and `UPDATER_PRIVATE_KEY`.
`deploy/prepareTauriConfig.js` turns these into configuration overrides; the app checks for updates only
when the build configures an endpoint, and only there.

## Icons

`icons/source/` holds the SVG sources. To regenerate the PNG, ICO and ICNS files:

```sh
rsvg-convert -w 1024 -h 1024 tauri/icons/source/icon.svg -o /tmp/icon.png
npx tauri icon /tmp/icon.png -o /tmp/icons        # copy the files listed in tauri.conf.json to tauri/icons
rsvg-convert -w 1024 -h 1024 tauri/icons/source/icon-macos.svg -o /tmp/icon-macos.png
npx tauri icon /tmp/icon-macos.png -o /tmp/icons-macos  # to tauri/icons/macos
rsvg-convert -w 32 -h 32 tauri/icons/source/tray-macos.svg -o tauri/icons/tray-macos.png
rsvg-convert -w 540 -h 380 tauri/images/source/background-dmg.svg -o tauri/images/background-dmg.png
```
