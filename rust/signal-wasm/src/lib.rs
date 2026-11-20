//! libsignal for the browser: exports with the names and signatures of
//! `Native` in `@signalapp/libsignal-client`, for the subset TeleSignal uses.
//! TypeScript in `src/lib/signal` calls them through `src/lib/signal/wasm`.
#![allow(non_snake_case)]

mod cipher;
mod error;
mod handles;
mod keys;
mod messages;
mod records;
mod stores;
mod tls;
mod usernames;
mod zkgroup;
