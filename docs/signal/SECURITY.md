# Security audit

Audit of 2026-11-21 of the tunnel (`proxy/`), the TLS client (`rust/signal-wasm`), the web app, the data at rest, logging,
the desktop app (`tauri/`) and the dependencies. Method: code review, unit tests, black-box runs of the tunnel, and
measurements in Chrome on a demo account (`signalDev.seedDemo()`), which show what the browser keeps at rest. Status
values: **fixed** (with a test or a before and after reproduction), **open** (needs a decision or more work),
**accepted** (a deliberate trade-off).

## Threat model

Assets: the account credentials, identity and session keys, the profile key, the account entropy pool and master key,
the message history, the contact list with numbers, and the decrypted attachments.

| Adversary | Can | Defence |
| --- | --- | --- |
| Operator of the tunnel, or the network | Drop, delay and reorder connections; see the host names, times and volumes | TLS runs in the page's WebAssembly and trusts only Signal's CA (`SIGNAL_CA_PEM`), so the tunnel cannot read or forge Signal traffic |
| Another website | Reach the tunnel through a visitor's browser; post to the app's share target | `Origin` check in the tunnel; the share target only pre-fills a draft |
| A message sender | Send text, file names, vCards, link previews, stickers, SVG and other attachments, long strings | Rendered as text nodes, attributes are escaped, links keep only allowed schemes, media is shown through `<img>` and `<video>` and streamed with `Content-Security-Policy: sandbox` |
| Someone with the browser profile or the files of the desktop app, without the passcode | Read IndexedDB, Cache storage, `localStorage`, files | With a passcode, Web A's state and the engine's stores and cached attachments are encrypted (S-02); what stays readable is listed there. Without a passcode nothing is encrypted |
| Script running in the page or the worker | Read everything the engine holds in memory and storage | Not defended by design: CSP without `unsafe-eval` and inline scripts, no third-party hosts, `check:hosts` in CI |
| Someone who gets the unlocked computer | Everything the user can do | Out of scope |

Out of scope: the Signal service, libsignal's cryptography, the browser and operating system, the user's phone.

## Findings

| ID | Severity | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| S-01 | High | Logout | Logging out from the passcode lock screen, or before the engine started, left the account, keys, messages and attachments, and the next load signed back in | Fixed |
| S-02 | High | Data at rest | With a passcode, the engine's stores (keys, account password, conversations, messages, attachments) stayed plaintext | Fixed: encrypted at rest, with listed fields left in the clear |
| S-03 | Medium | CSP | The production policy is a `<meta>` tag: it does not apply to the engine's Web Worker and cannot carry `frame-ancestors`; the desktop app had no policy at all | Fixed for the desktop app; web: the policy printer exists, the headers belong to the deployment |
| S-04 | Medium | Tauri | `shell:default` and `process:default` gave the page the shell plugin's `open` and the process `exit`; webviews could open new windows | Fixed |
| S-05 | Medium | Logout | Logging out did not remove the device from the account on the server | Fixed (linked devices, best effort) |
| S-06 | Low | Unlink | After the phone unlinked the browser, conversations and messages stayed in plaintext with no way to erase them from the app | Fixed |
| S-07 | Low | Logging | Production error logs carried ACIs, numbers and key-sized values | Fixed |
| S-08 | Low | Tauri | The record of saved files (paths, attachment keys) survived logout, and log lines named saved files | Fixed |
| S-09 | Low | Web | Links from messages sent the app's origin as `Referer` | Fixed (`same-origin`, not `no-referrer`) |
| S-10 | Low | CSP | `frame-src 'self'` although the app embeds no frames | Fixed |
| S-11 | Info | CSP | `connect-src` allows any `wss:` host and `style-src` allows inline styles | Accepted |
| S-12 | Info | Web | The share target accepts a cross-site POST and pre-fills a draft | Accepted |
| S-13 | Info | Build | Builds with `APP_ENV` other than `production` expose `signalDev` and `window.getGlobal` | Accepted: deployment rule |
| S-14 | Info | Tunnel | A client can hold the global handshake slots; the tunnel connects upstream before it checks the ClientHello | Accepted |
| S-15 | Info | Dependencies | 2 high and 22 moderate advisories in dev tooling; unmaintained crates in the desktop and WASM lockfiles | Accepted |

### S-01 Logout leaves the engine's data (High, fixed)

`signOut` and `signOutAllAccounts` wiped Web A's state and called the API's `destroy`, which wipes the engine's stores.
The API connector drops `destroy` while the worker is not initialized (`NO_QUEUE_BEFORE_INIT` in
`src/api/worker/connector.ts`): that is the case on the lock screen of a passcode, whose "forgot passcode" link runs
`signOutAllAccounts`, and during the first seconds after a load.

Reproduction before the fix (demo account, passcode set, reload, lock screen, `getActions().signOutAllAccounts()`):
`ts-signal` kept 7 records including the account password and identity keys, `ts-signal-messages` kept 12 conversations,
56 messages and 6 stories, and after the reload `localStorage.account1` was back: the engine found the account and
signed in again. After the fix the same steps leave 0 records, an empty attachment cache and no account.

Fix: `clearSignalLocalData()` (`src/lib/signal/clearLocalData.ts`) clears the stores and the attachment cache from the
page, whether or not the engine runs; both actions call it. Test: `src/lib/signal/clearLocalData.test.ts`.

### S-02 Engine stores are plaintext under a passcode (High, fixed)

Measured before the fix, with the demo account, passcode set, screen unlocked and locked: `ts-signal` (7 records:
`account` with `password`, identity key pairs, sessions, prekeys, profile key), `ts-signal-messages` (12 conversations
with names and numbers, 56 messages with `body`, 6 stories) and 9 decrypted images in `ts-signal-attachments` were all
readable; only Web A's own state (`tt-passcode`) was encrypted.

Now, while a passcode exists, the engine encrypts:

- every value of `ts-signal` (`SecureIdbStore`), and every conversation, message, story and call of `ts-signal-messages`
  (`recordCrypto.ts`), as AES-GCM envelopes `{ $enc: 1, iv, data }` with a random IV per write; the context
  (authenticated data) names the record's place, and for `ts-signal-messages` includes the fields left in the clear, so
  a record moved to another conversation, or with such a field changed, no longer decrypts;
- every cached attachment and sticker (`blobEncryption.ts`): chunks of 1 MiB in authenticated frames, the media type
  inside, each frame bound to the file's cache key, a random file id, its number and whether it is the last, so a cut,
  reordered, spliced or moved file does not decrypt. A file counts as encrypted only when its first frame decrypts, not
  by its first bytes, so a file in the clear that begins with the magic is encrypted like any other. Existing files are
  encrypted in place, none is dropped; a damaged cached file is only a cache entry and is deleted.

The key is `getEngineKey()` (random, in the passcode vault under the data key, wrapped again when the passcode
changes; one per vault generation, so every account slot has the same). The page gives it to the engine at every start
and when the passcode is turned on; the engine holds it as a non-extractable `CryptoKey` and forgets it when the screen
locks (the API closes), when the account is forgotten and when the connection is closed.

Lifecycle, as built after the review of the first version:

- **Turning on** encrypts this slot's stores and those of the other slots whose engine is not running, then counts: the
  call answers `true` only when a count finds nothing in the clear, and the page requires `=== true` (an answer of
  `undefined`, which a reset of the API produces for pending calls, fails the setup, which locks the passcode and the
  next start finishes it). A running engine of another slot encrypts its own stores when it next starts with the key
  (until then it works without one, as it did before the passcode existed); the same holds for a slot opened later.
- **Turning off** decrypts the stores of every slot that has data, the cached files of every slot, repeats until a count
  finds no encrypted record, and only then drops the key. It answers `true` only then. If another slot's engine is
  running (each engine holds the Web Lock `ts-signal-engine-<slot>`), it refuses and the page says to close the other
  accounts. If a record cannot be decrypted, it keeps the key, goes back to writing encrypted records, and the page keeps
  the passcode and says so. The records that the key does not open are erased only by the explicit engine call
  `eraseUnreadableStorageRecords`, which has no screen yet. It decrypts even when the marker is missing.
- **Writes never fail open.** Once a key was set, a write without it throws `StorageLockedError` and stores nothing; the
  requirement ends only when the stores are plain or wiped. `stopClient(true)` re-applies the key after the wipe, so an
  account linked in the same session is encrypted.
- **Start.** With a key, a count of the clear records (all of the small `ts-signal`, the newest 100 of each message,
  story and call store and every conversation) runs on the fast path and finds a record that a write left. Only a
  missing key stops the engine with `SignalStorageLocked`; any other failure of the encryption is logged, the engine
  starts, and the next start retries. Without a key: if the page has no passcode but the stores are marked encrypted (or
  an encrypted record is read), nothing can open them, so that slot is wiped and the link screen follows. The page clears
  the passcode store only when no engine store holds an encrypted record, so a failed wipe can be tried again, and a
  failure of `getEngineKey` shows `SignalStorageLocked`. A corrupted key blob fails a passcode change when any slot's
  stores are encrypted, instead of replacing the key.
- **Reads skip damage.** A message, story, call or conversation that cannot be decrypted is logged (first five only) and
  left out of the result, so one damaged record does not fail a chat.

What stays in the clear (everything else above is encrypted):

| Where | In the clear | Why |
| --- | --- | --- |
| `ts-signal` | record keys: `item:<name>`, `session:<aci>.<device>`, `identity:<id>`, `preKey:`, `signedPreKey:` and `kyberPreKey:<our id>:<n>`, `senderKey:`, `senderKeyInfo:<group id>`, `groupSendEndorsements:<group id>`, `recipient:<aci>`, `stickerPackManifest:<id>`, `storageRecord:<id>`, `sentProto:<timestamp>`, `unprocessed:<id>` | the engine lists records by prefix |
| `ts-signal` | `meta:encryption`: `{ state: 'on' or 'decrypting', isMigrated }` | a start without the key has to tell that the stores are encrypted |
| `ts-signal-messages` conversations | `id` (the contact's ACI or the group id), `localId` | key and unique index |
| `ts-signal-messages` messages | `id`, `conversationId`, `authorAci`, `sentAt`, `expiresAt` (when set), `sendRetry.at` (when set) | key and indexes: lookup by conversation, by author and timestamp, expiry and resend queues |
| `ts-signal-messages` stories | `id`, `authorAci`, `sentAt`, `expiresAt` | key and indexes |
| `ts-signal-messages` calls | `peerId`, `callId`, `timestamp` | compound key and the call log's index |
| Cache `ts-signal-attachments` | request URLs (`attachment/<digest>` or `attachment/<cdn>/<id>`, `sticker/<pack>/<n>`), the last-access header | cache keys |
| all | the number and size of records and files, and when they were written | observable from the files |

So the profile still shows with whom, and when, the user talked (ACIs, timestamps and counts per conversation), but not
what was said, who the contacts are by name or number, the keys, or the attachments. Not protected: the memory of the
engine and the page while they run (a script in the page can read what the engine reads), and an attacker who can change
the app's code. The caches `tt-media*` are not written at all under a passcode (unchanged).

Cost, measured in Chrome with 20,000 messages in 200 conversations and 300 sessions: reading a page of 50 messages 3.5 ms
against 6.2 ms without encryption (within noise), the conversation list 5.8 ms against 16.4 ms, unread messages of a
10,000-message chat 555 ms against 708 ms, one message by author and timestamp 0.3 ms against 0.2 ms; storing 1000
messages 347 ms; turning the passcode on or off with 20,000 messages 7.4 s once.

Proof in the browser (demo account, `proof.mjs` steps below), counting records with an envelope and the known secrets
(`Hi! Are we still on for Saturday?`, `Alice`, `+15550100001`, the password) in the stores:

| Step | `ts-signal` | conversations / messages / stories | attachment cache |
| --- | --- | --- | --- |
| no passcode | 0 of 7 encrypted, password in the clear | 0 of 12 / 56 / 6, names, numbers and texts readable | 9 readable images |
| passcode on | 7 of 8 (the marker), no leaks | 12 / 56 / 6 of 12 / 56 / 6, no leaks | 9 of 9 encrypted |
| locked | same | same | same |
| reload while locked | same, the engine does not start | same | same |
| unlocked again | same, 10 chats shown, pictures decode | same | same |
| passcode off | 0 of 7 encrypted, readable again | readable again | 9 readable images |

Proof with two account slots (two demo accounts, slot 2 at `?account=2`, Chrome on its own profile; counts of encrypted
records):

| Step | slot 1 | slot 2 |
| --- | --- | --- |
| both seeded, no passcode, slot 2's tab closed | stores, messages, calls and cached files readable | the same |
| passcode turned on in slot 1's tab | 9 of 10 `ts-signal` records (the marker is the tenth), 66 of 66 messages, 12 of 12 conversations, 6 of 6 calls and all cached files encrypted | the same: the idle slot was encrypted too |
| lock, reload, unlock | still encrypted, 10 chats shown | still encrypted |
| slot 2 opened in another tab (its engine runs), "turn off" | refused, passcode stays, everything still encrypted | its engine ran with the key |
| slot 2's tab closed, "turn off" | 0 encrypted, readable again | 0 encrypted, readable again; markers removed |

A tab that only navigated away can keep its worker, and so its lock, for a while (the page may be kept for going back),
and "turn off" refuses until that tab is closed.

Tests: `src/lib/signal/store/atRest.test.ts` (value encoding, key and context binding, `SignalStore`, every `MessageDb`
query before and after encryption, a moved record, interrupted migration, encrypted files) and
`atRestSafety.test.ts` (a full round trip of every record type, including `sendRetry`, which an earlier version
overwrote with its index copy; writes without the key; a start that fails for another reason, one without a passcode, one
that finds a record in the clear; turning off with two slots, with another slot running, with a damaged record and
without a marker; a deleted key not coming back; forged, moved and spliced files), `src/util/passcode/engineKey.test.ts`.

Not done: `getUnreadMessages` still reads and decrypts every message of the conversation, as it read every one before
(555 ms for 10,000 messages); a second tab turning the passcode on or off was reasoned about (`callApi` forwards to the
master tab's engine, the key travels over the `BroadcastChannel` that carries the data key) but only the slot case was
run; the engines of two slots in two tabs were run in the browser by `proof` step 7 below only where noted; there is no
screen for erasing unreadable records.

### S-03 The CSP does not cover the engine's worker (Medium, fixed for the desktop app)

A `<meta http-equiv="Content-Security-Policy">` applies to the document. A dedicated worker takes its policy from its own
response. Test: a page with `connect-src 'self'` in a meta tag could not `fetch` another origin, and a worker from the
same origin fetched it (`REACHED-OTHER-ORIGIN` in the server log). The Signal engine, with all keys, runs in such a
worker, so a policy that arrives only as a meta tag does not limit its network access, and `frame-ancestors` cannot be set
at all. The development server sends the policy as a header, so it does not show the gap.

The policy itself is sound: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (no `unsafe-eval`, no inline
scripts), `worker-src 'self'` (plus `blob:` only in development), `object-src 'none'`, `base-uri 'none'`,
`form-action 'none'`, `frame-src 'none'`, `connect-src` limited to the app, the tunnel and the proxy setting (S-11). Its
source is `plugins/csp.ts` (`buildCsp`), used by the page's meta tag and the dev server.

Desktop app: `app.security.csp` in `tauri/tauri.conf.json` now holds the production policy, so Tauri sends it as a
header with every file it serves, workers included; `plugins/csp.test.ts` fails when it drifts from `buildCsp('production')`.
`dangerousDisableAssetCspModification` is `["style-src"]`: Tauri otherwise adds a nonce to `style-src`, which makes
browsers ignore `'unsafe-inline'`, and the editor's and inputs' style elements were blocked (seen as `style-src-elem`
violations in the first run).

Test of the desktop build under Xvfb (WebKitGTK, a scratch build of the app with a self-test script added to the page,
which reports over `ws://127.0.0.1`, itself allowed by the policy): no policy violations after the change; the engine worker
started with WebAssembly and loaded the 10 demo chats; the IPC command `get_desktop_settings` answered; the native
transport opened a TLS connection to `chat.signal.org` through the app's TCP and returned the ServerHello (3,227 bytes,
`16 03 03`); a second instance started with `sgnl://signal.me/#p/%2B15550100001` forwarded its link to the running app
and the page took it (`takeDeepLinks`). Not tested: macOS and Windows (`http://tauri.localhost`, WKWebView, WebView2).
Pictures did not show in the demo chats, with the policy and without it (see `FRICTION_LOG.md`: the Cache API refuses
`tauri://` requests in WebKitGTK).

Web deployments: `npm run csp:print` prints the production policy for a response header (`dev/printCsp.ts`; it takes
`SIGNAL_TUNNEL_URL` and `APP_ENV` from the environment). The reverse proxy's headers, `frame-ancestors` and the rest are
the deployment's job (`proxy/README.md`, "Headers for the app", and the all-in-one image).

### S-04 Tauri capabilities (Medium, fixed)

Reviewed: `capabilities/default.json` is `local`, so only the app's page gets IPC; `on_navigation` allows only the app's
exact URL; the page's commands are the app's own (`build.rs` lists them, `removeUnusedCommands` is on); `dialog`,
`opener`, `fs` and `os` have no permission for the page; downloads that the webview starts are refused; the updater runs
only with an endpoint and a public key in the build config and the plugin verifies every signature, and the page cannot
override its endpoints.

Fixed:

- `shell:default` exposed the shell plugin's `open` to any script in the page. The page opened links through it. A native
  `open_external_url` command opens only `http`, `https`, `mailto` and `tel` URLs; the shell plugin and its npm package
  are removed.
- `process:default` allowed `exit` and `restart`; only `restart` is used.
- No handler denied `window.open`, which Windows webviews open as a window by default; `on_new_window` now denies it.

Tests: `opens_only_web_mail_and_phone_links_outside_the_app` in `tauri/src/lib.rs`.

### S-05 Logout does not unlink the device (Medium, fixed)

`destroy` forgot the account locally but left the device registered, so the server went on queueing messages for it and
using its prekeys until the phone removed it. Now logging out a linked device sends `DELETE /v1/devices/{id}` (a linked
device may remove only itself) while the data is wiped; the wipe never waits for the request and its failure, such as with
no connection, is only logged. The primary device and the demo account send nothing. Limits: a logout from the passcode
lock screen cannot do it, because the engine is not running and the credentials are encrypted without the key; and a page
that reloads right away may cut the request. Test: `src/api/signal/methods/client.test.ts`.

### S-06 Phone-initiated unlink kept the data (Low, fixed)

`handleUnlinked` kept conversations and messages until another account linked (as Signal Desktop's soft unlink), and the
link screen had no "erase" action, so the data stayed in plaintext on a shared computer. Now a confirmed deauthorization
(the chat socket and `GET /v1/accounts/whoami` both answer 401 or 403: the phone or another device removed this device,
or the number of the primary device was registered elsewhere) stops the client and wipes the slot's account, keys,
messages and attachments (`handleDeauthorized` in `src/api/signal/client.ts`), then the app runs its normal logout and
shows the link screen with a notification. A network error, a 5xx or a successful `whoami` after a 401 wipes nothing.
Data that an earlier version left without an account is removed when the link screen starts. Tests:
`src/api/signal/client.test.ts`.

### S-07 Logging (Low, fixed)

Production logs: all errors of the engine go through `logError` (`src/api/signal/engine.ts`) and the global
`handleError`; their text named ACIs (`Profile request for <aci> failed`) and could name numbers. They now print
`maskSensitiveText(...)` of the error's stack in production (`src/util/maskSensitiveText.ts`: UUIDs, E.164 numbers and
runs of 32 or more key-sized characters are replaced), and the error object in development. The other `console.*` calls
in production code print no message content, keys, numbers or ACIs (checked: they are guarded by `DEBUG`, or print
error objects and fixed text; the link-open failure no longer prints the URL). `signalDev` and `window.getGlobal` exist
only when `DEBUG` is true (S-13). Test: `src/util/maskSensitiveText.test.ts`.

### S-08 Saved files in the desktop app (Low, fixed)

`saved_files.json` in the app data directory lists the paths and attachment keys of every saved file and was never
cleared. `forget_saved_files` drops the records (the files stay) and logout calls it; Rust log lines no longer print
file paths. Test: `clearing_drops_every_record_from_storage` in `tauri/src/files.rs`.

### S-09, S-10 Referrer and frames (Low, fixed)

`<meta name="referrer" content="same-origin">` keeps the app's origin from the sites that links open and still sends
the referrer between the app's own pages, which the multi-account "back" navigation reads (`document.referrer`); `frame-src` is
`'none'` because the only iframe, Telegram's Instant View embed, is unreachable in the Signal app.

### S-11 to S-13 Accepted

- `connect-src` has `wss:` because the Proxy server setting accepts any `wss://` URL at runtime, which a static policy
  cannot list. `style-src 'unsafe-inline'` is for style attributes that the UI sets; scripts have no inline allowance.
  `blob:` and `data:` in `connect-src` serve `fetch` of object URLs.
- The web share target (`/share/`) can be posted to by any site and opens a draft; the user still picks a chat and sends.
- Deployments must build with `APP_ENV=production`: other values enable the developer console tools.

### S-14 Tunnel observations (Info, accepted)

No bypass found (see below). Two limits remain: `MAX_HANDSHAKES` slots are global, so one client can keep them busy
for `HANDSHAKE_TIMEOUT_SECS` (the reverse proxy's connection limits cover this), and the upstream TCP connection opens
before the ClientHello check (a bad client costs a connection of 10 seconds at most, within its per-client limits).

### S-15 Dependencies (Info, accepted)

- `npm audit --omit=dev`: 0 advisories. The full audit reports 2 high (`undici` 4 to 6.29 and 8.0 to 8.12 through
  `jsdom`, `zod` below 4.6.6 in tooling) and 22 moderate advisories, all in `devDependencies` (test runner, linters, icon
  and bundle tooling); none ships in the app. `npm audit fix` finds nothing it may change without a major update.
- `cargo audit` (advisory database of 2026-11-21): no vulnerabilities in `proxy/`, `tauri/`, `rust/signal-wasm` and
  `rust/libsignal`. Warnings only: unmaintained `chrono`, `paste`, `bincode`, `proc-macro-error(2)`, `ttf-parser`,
  `zbus_names`, `zvariant`; and `glib` 0.18 (unsound `VariantStrIter`) through Tauri's GTK stack, which the app does
  not call and which Tauri has to update.

## Reviewed without findings

### Tunnel (`proxy/`, `tauri/src/transport.rs`)

- Allowlist: exact, lowercase DNS names from `ALLOWED_HOSTS`, port 443 only, no percent-decoding, so IP literals,
  `host:port`, trailing dots, case variants and NUL are refused. `host` and `port` may appear once.
- SNI against host: the first bytes must be a ClientHello whose only `server_name` is the requested host (checked
  case-insensitively against the allowlist entry); `encrypted_client_hello`, a second name, a name type other than
  `host_name`, trailing bytes, and a hello over 16 KiB are refused. The upstream is the allowlisted host, whatever the
  client names. TLS is never terminated: after the check the relay copies bytes.
- DNS rebinding and SSRF: the name is resolved once, only public addresses are used (IPv4-mapped and NAT64 forms are
  unwrapped first), and the connection goes to the checked address. With `UPSTREAM_PROXY` the proxy resolves (documented).
- Origin: loopback origins by default, exact origins by configuration, two `Origin` headers are refused, no `Origin`
  needs `ALLOW_NO_ORIGIN=1`. It protects against other websites, not against non-browser clients.
- Resources: global and per-client tunnel counts, new-tunnel rate, bandwidth, optional hourly bytes, bans after
  repeated violations, bounded client table, bounded handshake count, request head and WebSocket message sizes, hello
  and idle timeouts, bounded write buffers. The desktop app reuses the same library.
- Black-box run of the built tunnel: a ClientHello for `cdn.signal.org`, `example.com` or an IP on a tunnel to
  `chat.signal.org` closes with 1008 "server name mismatch" and no upstream bytes; the matching one gets the server's
  answer; a missing or foreign `Origin`, `host=127.0.0.1` and `port=22` get 403.
- Tests (new, `cargo test` in `proxy/`): allowlist, target parsing, origin matching, public-address ranges, proxy URL
  parsing, limits, the ClientHello parser on valid, malformed, split and oversized hellos, and 200,000 deterministic
  mutations that must not panic and never accept a hello without the host name. `cargo fuzz` needs nightly; the mutation
  test runs in `cargo test` instead.

### TLS client (`rust/signal-wasm/src/tls.rs`, `src/lib/signal/net/TlsTunnel.ts`)

`RootCertStore` holds only `SIGNAL_CA_PEM` (Signal's root, valid to 2032-01-24), the server name is the host being
contacted, rustls verifies the chain and the name, ALPN is `h2` or `http/1.1`, there is no client authentication and no
way to disable verification. Every host in use (chat, storage, cdn, cdn2, cdn3, cdsi, contentproxy, svr2, sfu) is both
in `src/lib/signal/config.ts` and in the tunnel's allowlist. CDSI and SVR2 use the attested connections of libsignal's
`attest` with the production MRENCLAVE values in `config.ts` and tests that reject another enclave, an expired report
and a modified byte (see PLAN.md). Certificate dates use the device clock, so a wrong clock fails closed.

### Web app

- XSS: no `dangerouslySetInnerHTML`; `innerHTML` is used for LaTeX markup (`Latex.tsx`), for copying the app's own
  rendered selection, and in an inert `template` for pasted HTML. Message text, entities, file names, contacts and link
  previews render as text nodes; the HTML builders escape attributes (`escapeHtmlAttribute`) and `ensureProtocol`
  keeps `http`, `https`, `mailto`, `tel`, `tg`, `sgnl` and `ton`, so `javascript:` and `data:` links become web
  addresses. Message links open through `SafeLink`, which asks before leaving for a suspicious link or one whose text
  differs from its address. SVG attachments are shown through `<img>`, which does not run scripts, and streamed media carries
  `Content-Security-Policy: sandbox` and `nosniff`.
- `postMessage`: the only window handler (`EmbedFrame`) checks that the event comes from its iframe, which the policy
  now forbids; the other channels are same-origin `BroadcastChannel`s and the service worker.
- Service worker: it caches only same-origin static assets matched by hashed file names and the app shell, with
  `response.ok` only; it does not cache media when a passcode exists. Decrypted media lives in `ts-signal-attachments`
  and in the `tt-media*` caches, which logout clears (measured after the fix: the static `tt-assets` and empty media
  caches are left).

## Verifying again

1. `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` in `proxy/` and `tauri/`.
2. `npm run check:ts`, `npm run check:hosts`, and `npx vitest run src/lib/signal/clearLocalData.test.ts
   src/util/maskSensitiveText.test.ts src/util/passcode/engineKey.test.ts`.
3. At rest and logout: run `npm run dev`, open the page in Chrome, call `await signalDev.seedDemo()` in the console, reload,
   set a passcode in Settings, and list `indexedDB.databases()`, `localStorage` and `caches.keys()`. With a passcode
   `ts-signal*` must hold no readable message text or password, and the cached images must start with `TSE1`. For S-01: lock, reload, "forgot passcode" and log out;
   every store above must be empty after the reload and the app must not sign in again.
4. CSP in workers: serve the built app without headers and with the headers of `proxy/README.md`, and fetch another
   origin from the worker (the engine's `worker-*.js`) in each case.
