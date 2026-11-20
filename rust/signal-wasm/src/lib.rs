//! libsignal for the browser: exports with the names and signatures of
//! `Native` in `@signalapp/libsignal-client`, for the subset TeleSignal uses.
//! `src/lib/signal/libsignal/Native.ts` adapts these exports to the wrapper.
#![allow(non_snake_case)]

mod cipher;
mod error;
mod handles;
mod keys;
mod messages;
mod records;
mod stores;
mod tls;
mod zkgroup;
