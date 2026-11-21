# Friction log

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

## Desktop notifications cannot open the chat that they announce

`src/util/notifications.tsx` shows the desktop app's notifications with `sendNotification({ title, body })` of
`@tauri-apps/plugin-notification`. On desktop the plugin shows the notification through `notify-rust` and drops the
handle (`tauri-plugin-notification` 2.5.1, `src/desktop.rs`), and `onAction` exists on mobile only, so a click reaches
the page as nothing, and the plugin offers no inline reply or grouping either. Verified by reading the plugin's source;
not tried on macOS or Windows. Opening the chat needs native code per system (a `notify-rust` handle on Linux, a
`UNUserNotificationCenter` delegate on macOS, a toast activation on Windows), or a heuristic: remember the last
notified chat and open it when the window gains focus soon after.

## The desktop app ships the webview inspector, so production turns off the context menu

`tauri/Cargo.toml` enables the `devtools` feature of `tauri`, which keeps the inspector in release builds, and
`src/util/tauri/setupTauriListeners.ts` cancels every `contextmenu` event outside `DEBUG` to hide it. The same line
removes the system menu of text fields (cut, copy, paste, select all, spellcheck suggestions), and the inputs turn
spellcheck off (`spellCheck={IS_TAURI ? false : undefined}`). Verified by reading both places; the inspector in a
release build is not tried. Either dropping the feature or showing the system menu on editable targets only, with
the inspector off, would restore text field menus.

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
