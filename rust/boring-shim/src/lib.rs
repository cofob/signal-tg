//! A pure-Rust implementation of the subset of the [`boring`](https://github.com/signalapp/boring) API that
//! libsignal's `attest` crate uses for SGX DCAP attestation: X.509 and CRL parsing, chain verification against a
//! trust store with CRL checks, and ECDSA P-256 verification.
//!
//! Only what attestation needs is supported. Other algorithms (P-384, RSA) fail verification, which makes the
//! Nitro attestation path unusable; Signal's CDSI and SVR2 enclaves are SGX enclaves and use P-256 only.
//! Verification follows BoringSSL `X509_verify_cert` with `X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL`
//! (`crypto/x509/x509_vfy.cc`), failing closed wherever this implementation is narrower.

#![deny(unsafe_code)]

pub mod asn1;
pub mod bn;
pub mod ec;
pub mod ecdsa;
pub mod error;
pub mod nid;
pub mod pkey;
pub mod stack;
pub mod x509;

mod chain;
mod der;
