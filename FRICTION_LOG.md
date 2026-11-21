# Friction log

## `.gitignore` ignores every `tests/` directory

The root `.gitignore` has a bare `tests/` pattern (from Telegram Web A), so any directory named `tests` anywhere in the
repository is ignored without a warning. Verified: libsignal's `rust/attest/tests/data`, which `attest` includes in
every build (`sgx_session::testutil`), and the Rust integration tests of `rust/boring-shim` were silently left out of a
commit; `git status` showed nothing. Both now have `!` exceptions in `.gitignore`, but the next vendored crate or Rust
crate with a `tests` directory hits the same trap. Anchoring the pattern to the directory it was meant for (probably
`/tests/`) would remove it.
