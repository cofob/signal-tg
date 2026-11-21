# Friction log

## Release scripts from Telegram Web A remain in `package.json`

`web:release:production` (commits `dist/` and pushes) and `telegraph:update_changelog` (posts to telegra.ph) belong to
the upstream release flow and do not fit TeleSignal's releases (`docs/RELEASING.md`). The second one also contradicts
the rule that the app talks only to its own origin and the tunnel, although it is a maintainer script.
