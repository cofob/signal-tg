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
