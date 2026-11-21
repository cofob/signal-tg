# Friction log

## The dev server warm-up lists a bundle that no longer exists

`DEV_BUNDLE_WARMUP_CLIENT_FILES` in `vite.config.ts` still names `src/bundles/stars.ts`, which the Stars removal deleted.
Verified: every `vite` or `vitest` start logs `Pre-transform error: Failed to load url /src/bundles/stars.ts`. The
message is harmless but hides real warm-up errors in the same output.

## `tauri/` is not rustfmt-clean

`cargo fmt --check` in `tauri/` reports differences, for example in `src/mac.rs`, so CI runs Clippy and the tests for
the crate but not rustfmt. The repository rules do not require formatting there. Formatting the crate once (the
`rustfmt.toml` sets two-space indentation) would let CI check it like `proxy/`.

## The built `dist/` directory is tracked

`git ls-files dist` lists about 11 500 files (145 MB), the output of `npm run web:release:production` from Telegram
Web A's release flow, although only `dist/build-stats.json` is ignored. Every `npm run build:production` rewrites
tracked files, so a build leaves the working tree dirty and CI cannot check that the committed bundle is current. The
release workflow publishes a bundle built from the tag instead and does not use the tracked one.

## Release scripts from Telegram Web A remain in `package.json`

`web:release:production` (commits `dist/` and pushes) and `telegraph:update_changelog` (posts to telegra.ph) belong to
the upstream release flow and do not fit TeleSignal's releases (`docs/RELEASING.md`). The second one also contradicts
the rule that the app talks only to its own origin and the tunnel, although it is a maintainer script.

## A join request cannot be canceled after the group changed

A user whose join request waits for admin approval keeps the state that `buildRequestedState` in
`src/lib/signal/groups/GroupManager.ts` made from the join response: its revision, no group link password, and no read
access to the group (`GET /v2/groups/` answers 403). Verified against the fake storage service of the groups test
harness: when anyone changes the group after the request, canceling it through `buildLeaveChange` conflicts (409) at
every attempt, since `MessageProcessor.refreshGroup` cannot learn the new revision, and fails with "The group change
conflicted with other changes too many times". Whether the real server behaves the same is not verified. The revision
is available from `fetchGroupJoinInfo`, which needs the group link password that the requested state does not keep.
