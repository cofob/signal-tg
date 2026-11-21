# Friction log

## `.gitignore` ignores every `tests/` directory

The root `.gitignore` has a bare `tests/` pattern (from Telegram Web A), so any directory named `tests` anywhere in the
repository is ignored without a warning. Verified: libsignal's `rust/attest/tests/data`, which `attest` includes in
every build (`sgx_session::testutil`), and the Rust integration tests of `rust/boring-shim` were silently left out of a
commit; `git status` showed nothing. Both now have `!` exceptions in `.gitignore`, but the next vendored crate or Rust
crate with a `tests` directory hits the same trap. Anchoring the pattern to the directory it was meant for (probably
`/tests/`) would remove it.

## `cargo fmt --check` fails in `tauri/` before any change

Verified on `ba4e008`: `cargo fmt --check` in `tauri/` reports two diffs in `src/mac.rs` (calls of
`position_traffic_lights` that rustfmt puts on one line), and nothing else. The file compiles only on macOS, so
`cargo clippy` on other systems never reads it, but `cargo fmt` does. The check therefore cannot gate a change to
`tauri/` without first telling these old diffs from new ones. Running `cargo fmt` in `tauri/` once would remove it; it
was left out of the change that found it because it touches an unrelated file.
