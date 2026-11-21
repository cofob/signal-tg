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

## The desktop app cannot switch on spell checking in WebKitGTK

The composer sets `spellcheck` (`MessageInput.tsx`) and the system context menu is allowed in text fields
(`setupTauriListeners.ts`), but on Linux the webview decides whether to spell-check, through
`webkit_web_context_set_spell_checking_enabled`, which neither `wry` 0.57 nor the app calls (a search for "spell" in the
`wry` and `tauri` sources finds nothing). Verified under Xvfb with WebKitGTK 2.52: misspelled words in the composer got
no underline and the context menu had no suggestions, though the system may lack dictionaries there. Calling it from
`Webview::with_webview` needs the `webkit2gtk` crate as a direct dependency, which the tree has through `wry` but
`tauri/Cargo.toml` does not list. Whether WKWebView (macOS) and WebView2 (Windows) spell-check the composer is not
tried.

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
