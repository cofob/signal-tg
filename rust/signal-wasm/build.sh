#!/usr/bin/env bash
# Builds the libsignal WebAssembly module into `src/lib/signal/wasm/generated`.
# Requires the toolchain from `rust-toolchain` with the `wasm32-unknown-unknown` target,
# `protoc`, and `wasm-bindgen-cli` matching the `wasm-bindgen` version in `Cargo.lock`.
set -euo pipefail

cd "$(dirname "$0")"
TARGET_DIR="${CARGO_TARGET_DIR:-target}"
OUT_DIR=../../src/lib/signal/wasm/generated

cargo build --release
rm -rf "$OUT_DIR"
wasm-bindgen --target web --weak-refs --out-dir "$OUT_DIR" \
  "$TARGET_DIR/wasm32-unknown-unknown/release/signal_wasm.wasm"
