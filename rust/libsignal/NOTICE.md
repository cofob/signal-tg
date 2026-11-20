# libsignal provenance

This directory vendors part of [signalapp/libsignal](https://github.com/signalapp/libsignal), tag `v0.108.3`,
commit `b2f93b8acc90268ebf31a9e225b6e59b4dd7693c`, licensed under AGPL-3.0-only (`LICENSE`).
`rust/signal-wasm` builds these crates into the browser module.

## Vendored files

- Workspace files: `Cargo.toml`, `Cargo.lock`, `rust-toolchain`, `.rustfmt.toml`, `LICENSE`.
- Crates under `rust/`: `account-keys`, `attest`, `cli-utils`, `core`, `crypto`, `debug`, `message-backup`
  (with `macros`), `poksho`, `protocol` (with `test-support`), `svrb`, `usernames`, `zkcredential`, `zkgroup`.

Not vendored: the other crates (`bridge`, `net`, `media`, `keytrans`, `device-transfer`, `provisioning`), the
Java, Swift and Node packages, the `fuzz` directories, `rust/protocol/cross-version-testing` and `.cargo/`.

## Local changes

- `Cargo.toml`: `members` and `default-members` list only the vendored crates.

## Updating

1. Check out the new libsignal tag.
2. Replace the vendored files and crates listed above, then remove `rust/*/fuzz` and
   `rust/protocol/cross-version-testing`.
3. Reapply the local changes and update the tag and commit in this file.
4. Copy `Cargo.lock` and `rust-toolchain` to `rust/signal-wasm/`, run `npm run signal:wasm` and fix
   `rust/signal-wasm` against API changes in the bridge sources (`rust/bridge/shared/src` upstream).
