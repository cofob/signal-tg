//! libsignal for the browser: exports with the names and signatures of
//! `Native` in `@signalapp/libsignal-client`, for the subset TeleSignal uses.
//! TypeScript in `src/lib/signal` calls them through `src/lib/signal/wasm`.
#![allow(non_snake_case)]

mod account_keys;
mod attestation;
mod backups;
mod cipher;
mod error;
mod handles;
mod keys;
mod keytrans;
mod messages;
mod records;
mod stores;
mod svrb;
#[cfg(feature = "test-server")]
mod svrb_fake;
mod tls;
mod usernames;
mod zkgroup;
