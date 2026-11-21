# libsignal provenance

This directory vendors part of [signalapp/libsignal](https://github.com/signalapp/libsignal), tag `v0.108.3`,
commit `b2f93b8acc90268ebf31a9e225b6e59b4dd7693c`, licensed under AGPL-3.0-only (`LICENSE`).
`rust/signal-wasm` builds these crates into the browser module.

## Vendored files

- Workspace files: `Cargo.toml`, `Cargo.lock`, `rust-toolchain`, `.rustfmt.toml`, `LICENSE`.
- Crates under `rust/`: `account-keys`, `attest`, `cli-utils`, `core`, `crypto`, `debug`, `message-backup`
  (with `macros`), `poksho`, `protocol` (with `test-support`), `svrb`, `usernames`, `zkcredential`, `zkgroup`.
- `rust/attest/tests/data`, which `attest::sgx_session::testutil` includes in every build; the other crates' `tests`
  directories are not vendored.

Not vendored: the other crates (`bridge`, `net`, `media`, `keytrans`, `device-transfer`, `provisioning`), the
Java, Swift and Node packages, the `fuzz` directories, `rust/protocol/cross-version-testing` and `.cargo/`.

## Local changes

- `Cargo.toml`: `members` and `default-members` list only the vendored crates.
- `rust/attest/src/util.rs`: on `wasm32`, `time_t` is `i64` instead of `libc::time_t`, which `libc` does not define for
  `wasm32-unknown-unknown`.

`attest` depends on `boring` (BoringSSL), which does not build for `wasm32-unknown-unknown`. `rust/signal-wasm` patches
it with `rust/boring-shim`, a pure-Rust implementation of the part of the `boring` API that `attest` uses (X.509 and
CRL verification, ECDSA P-256); `rust/boring-shim/src/lib.rs` describes what it supports.

## Updating

1. Check out the new libsignal tag.
2. Replace the vendored files and crates listed above, then remove `rust/*/fuzz` and
   `rust/protocol/cross-version-testing`.
3. Reapply the local changes and update the tag and commit in this file.
4. Copy `Cargo.lock` and `rust-toolchain` to `rust/signal-wasm/`, run `npm run signal:wasm` and fix
   `rust/signal-wasm` against API changes in the bridge sources (`rust/bridge/shared/src` upstream).
5. If `attest` uses more of `boring`, extend `rust/boring-shim` and run the attestation tests:
   `cargo test --release --target x86_64-unknown-linux-gnu attestation` in `rust/signal-wasm`.
