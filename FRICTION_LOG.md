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
