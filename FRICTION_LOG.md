# Friction log

## UI actions still call removed Telegram API methods

`src/api/signal/methods/types.ts` lists the names of Telegram methods that `callApi` accepts but the engine does not implement. Each call resolves to `undefined`, so the code after it is dead; their results are typed `any`, which made some callbacks need explicit parameter types after GramJS was removed (verified with `tsc`). 101 names remain (212 at the start of the dead UI sweep). Some wait for the engine and have a working Signal feature behind them: folders, pins, scheduled-style sends, local search (`searchMessagesInChat`, `searchMessagesGlobal`), drafts, default timer, contacts and profile photo. The rest are Telegram-only and still have UI and actions, which removing the name exposes through `tsc`: ephemeral messages and bots (`sendEphemeralMessage`, `deleteEphemeralMessage`; about 340 mentions of `isEphemeral` and `ephemeralBotId`, message views and forwards counters, `forwardInfo.isChannelPost`), account and privacy screens (`fetchPrivacySettings`, `fetchGlobalPrivacySettings`, `fetchContentSettings`, `fetchAccountTTL`, birthdays, `toggleNoForwards` with `NoForwardsRequest`, profile and saved music), emoji, sticker and GIF server features (custom emoji, status emoji, favorite and saved GIFs, dice, emoji groups), Telegram stories extras (albums, archive, profile pins, story links) and wallpapers and chat themes. Delete each group with its action handlers, payload types, components and cache cleanup, and drop the names with `tsc` as the guide.

## Upstream helper scripts that nothing calls remain in `dev/` and `deploy/`

`dev/createBundleStatsComment.ts` (a pull request comment with bundle sizes, keyed by the removed `stars` and `wallet`
bundles) and `deploy/copy_to_dist.sh` (copies static files into `dist` for Telegram Web A's deployment) are not
referenced by `package.json`, by `.github/workflows/*` or by other code. Verified with a repository-wide search; the
files come from Telegram Web A's pipeline and do not match TeleSignal's CI (`docs/RELEASING.md`). They can be deleted
or, for the bundle size comment, rewritten for the current bundles and wired into `ci.yml`.

## A join request cannot be canceled after the group changed

A user whose join request waits for admin approval keeps the state that `buildRequestedState` in
`src/lib/signal/groups/GroupManager.ts` made from the join response: its revision, no group link password, and no read
access to the group (`GET /v2/groups/` answers 403). Verified against the fake storage service of the groups test
harness: when anyone changes the group after the request, canceling it through `buildLeaveChange` conflicts (409) at
every attempt, since `MessageProcessor.refreshGroup` cannot learn the new revision, and fails with "The group change
conflicted with other changes too many times". Whether the real server behaves the same is not verified. The revision
is available from `fetchGroupJoinInfo`, which needs the group link password that the requested state does not keep.

## The desktop app cannot switch on spell checking in WebKitGTK

The composer sets `spellcheck` (`MessageInput.tsx`) and the system context menu is allowed in text fields
(`setupTauriListeners.ts`), but on Linux the webview decides whether to spell-check, through
`webkit_web_context_set_spell_checking_enabled`, which neither `wry` 0.57 nor the app calls (a search for "spell" in the
`wry` and `tauri` sources finds nothing). Verified under Xvfb with WebKitGTK 2.52: misspelled words in the composer got
no underline and the context menu had no suggestions, though the system may lack dictionaries there. Calling it from
`Webview::with_webview` needs the `webkit2gtk` crate as a direct dependency, which the tree has through `wry` but
`tauri/Cargo.toml` does not list. Whether WKWebView (macOS) and WebView2 (Windows) spell-check the composer is not
tried.

## A launch at login on Linux hides the window even when no tray host runs

`tauri/src/lib.rs` opens the first window hidden for `--autostart` (`SHOULD_START_HIDDEN`), and the tray icon is how a
hidden window comes back. On a Linux desktop without a StatusNotifier host (GNOME without the AppIndicator extension,
for example) nobody can show the window except by launching the app a second time. Verified by reading the code; the
hidden start itself was tried under Xvfb, a missing tray host was not. Detecting the host means asking the session bus
whether `org.kde.StatusNotifierWatcher` has an owner, which needs `zbus` (in the tree through `notify-rust`) as a
direct dependency; the start could then stay visible without one.

## The demo account has no downloadable document and no file with a risky name

`seedDemo` (`src/lib/signal/dev/seedDemo.ts`) draws its photos into the attachment cache, but the one document in it,
`report.pdf`, is marked unavailable. In the desktop app the Open confirmation for a dangerous type (`.exe`, `.sh`,
...), the document click that opens a saved file and the "moved or deleted" answer for a document cannot be tried
without a linked account. Only photos could be saved and opened in the Xvfb run; the confirmation is covered by unit
tests of `is_file_dangerous` alone, and its native dialog was not shown.

## The app cannot tell whether this device is the primary device of the account

Features that only a primary device has, such as the recovery key (`fetchRecoveryKey` in
`src/api/signal/methods/profile.ts`), cannot be hidden from linked devices: no part of the global state carries the
device kind, and `global.config` and `global.appConfig` are cached and loaded independently of the account. The
Settings > Privacy row "Recovery key" therefore shows on every device and a linked device answers with a notification.
Verified by reading the code: `AccountRecord.deviceId` lives only in `SignalStore`, behind the API layer. A flag that
the API sends with the current user, or an app config field that follows the account, would let the row and its search
entry follow `requires` like `arePasskeysAvailable`.

## Playwright screenshots of a focused input make `stricterdom` report `style` mutations

In development builds `src/lib/fasterdom/stricterdom.ts` logs "Unexpected mutation detected: `style`" for each
attribute change outside the mutation phase. `page.screenshot()` of Playwright hides the caret by default, which sets
`caret-color: transparent !important` in the `style` attribute of the focused element and removes it afterwards, so
every screenshot with a focused `input` adds two such errors (verified on the demo account: 0 errors after load, after
opening a chat and after typing; 2 more after each default screenshot, none with `caret: 'initial'`). The error text
names no element, so these reports look like a component bug. Browser verification scripts should pass
`caret: 'initial'`; `stricterdom` could name the target element and ignore `caret-color`.

## `ListItem` acts on the press, so a control in `rightElement` also opens the row

On pointer devices `ListItem` (`src/components/ui/ListItem.tsx`) runs `onClick` from the `mousedown` of its button
(`handleMouseDown`), not from the click. A `Switcher` or `Button` in `rightElement` therefore triggers the row's own
`onClick` unless the wrapper stops both `mousedown` and `click` (`SettingsNotificationProfiles.tsx` does). Verified in
the demo account by toggling a profile, which opened its editor until `mousedown` was stopped as well. A prop of
`ListItem` for controls that must not open the row, or `Switcher` stopping the press itself, would remove the need for
each caller to find this out.

## The API connector drops `destroy` and `reconnectNow` while the engine is not started

`NO_QUEUE_BEFORE_INIT` in `src/api/worker/connector.ts` makes `callApi` and `callApiLocal` resolve these two calls to `undefined` when the worker is not initialized, which is the case on the lock screen of a passcode and in the first seconds after a load. That suited GramJS, which had nothing at rest in the worker. The Signal engine keeps the account, keys and messages in IndexedDB and the Cache API, so a `destroy` that never arrives leaves them (reproduced in Chrome on the demo account; the logout actions now clear the stores from the page with `clearSignalLocalData()`, see S-01 in `docs/signal/SECURITY.md`). A new method that has to act on the stores without a started engine needs the same page-side route, and nothing in the connector says so; whether `destroy` should start the worker and run, or the stores' clearing should be reachable from the page only, is undecided.

## Backups cannot end DEFLATE blocks at exact offsets, since `fflate` breaks on a sync flush

`src/lib/signal/backups/backupWriter.ts` ports the gzip of Signal Desktop `toPaddedGzipIterable`, which ends a DEFLATE
block around the account data and recipients and at the offsets of `MessageBackupSizing_FlushInterval`, then pads by
`MessageBackupSizing_PaddingSize` for the largest block. `fflate` 0.8.3 `Gzip.flush(true)` (the sync flush that ends the
block) produces data that Node's `gunzipSync` rejects with "invalid stored block lengths" when a block holds
incompressible bytes such as keys: 96 of 200 random inputs failed with `flush(true)` and none with `flush()`. Verified in
a Node script that pushes four chunks of text and random bytes with a flush after each. The writer uses `flush()`, so
the blocks end where the compressor ends them and the padding follows the uncompressed size of the intervals; the
backups are valid for libsignal's validator, but the padding is not exactly what the format describes. Whether another
library or `CompressionStream` with a manual flush could end blocks exactly is not tried.
