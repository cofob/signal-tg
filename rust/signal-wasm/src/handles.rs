//! Opaque handles that JS passes back to the exported functions.
//!
//! Each handle is a wasm-bindgen class owning one libsignal value. `Native.ts`
//! stores the class instance as the wrapper's `_nativeHandle`.

use libsignal_protocol as lsp;
use wasm_bindgen::prelude::*;

macro_rules! handle {
    ($name:ident, $inner:ty) => {
        #[wasm_bindgen]
        #[derive(Clone)]
        pub struct $name(pub(crate) $inner);

        #[wasm_bindgen]
        impl $name {
            /// Arrays of handles are passed by value, so `Native.ts` passes clones to keep the caller's handles valid
            #[wasm_bindgen(js_name = cloneHandle)]
            pub fn clone_handle(&self) -> $name {
                self.clone()
            }
        }
    };
    ($name:ident, $inner:ty, no_clone) => {
        #[wasm_bindgen]
        pub struct $name(pub(crate) $inner);
    };
}

handle!(PrivateKey, lsp::PrivateKey);
handle!(PublicKey, lsp::PublicKey);
handle!(KyberKeyPair, lsp::kem::KeyPair);
handle!(KyberPublicKey, lsp::kem::PublicKey);
handle!(KyberSecretKey, lsp::kem::SecretKey);
handle!(ProtocolAddress, lsp::ProtocolAddress);
handle!(PreKeyRecord, lsp::PreKeyRecord);
handle!(SignedPreKeyRecord, lsp::SignedPreKeyRecord);
handle!(KyberPreKeyRecord, lsp::KyberPreKeyRecord);
handle!(SessionRecord, lsp::SessionRecord);
handle!(SenderKeyRecord, lsp::SenderKeyRecord);
handle!(PreKeyBundle, lsp::PreKeyBundle);
handle!(SignalMessage, lsp::SignalMessage);
handle!(PreKeySignalMessage, lsp::PreKeySignalMessage);
handle!(SenderKeyMessage, lsp::SenderKeyMessage);
handle!(SenderKeyDistributionMessage, lsp::SenderKeyDistributionMessage);
handle!(PlaintextContent, lsp::PlaintextContent);
handle!(DecryptionErrorMessage, lsp::DecryptionErrorMessage);
handle!(CiphertextMessage, lsp::CiphertextMessage, no_clone);
handle!(ServerCertificate, lsp::ServerCertificate);
handle!(SenderCertificate, lsp::SenderCertificate);
handle!(UnidentifiedSenderMessageContent, lsp::UnidentifiedSenderMessageContent, no_clone);
handle!(Fingerprint, lsp::Fingerprint);
