//! Session, sealed sender and sender key operations.
//!
//! wasm-bindgen async exports cannot borrow handles across `.await`, so each
//! function clones its arguments and returns a `Promise`.

use js_sys::Promise;
use libsignal_protocol::{self as lsp, ServiceId};
use rand::TryRngCore as _;
use uuid::Uuid;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use crate::error::{JsResult, ProtocolResultExt, protocol_error};
use crate::handles::*;
use crate::records::timestamp;
use crate::stores::JsStore;

const SERVICE_ID_FIXED_WIDTH_LENGTH: usize = 17;

fn uuid_from_bytes(bytes: &[u8], operation: &str) -> JsResult<Uuid> {
    Uuid::from_slice(bytes).map_err(|_| {
        protocol_error(
            lsp::SignalProtocolError::InvalidArgument("invalid UUID".to_owned()),
            operation,
        )
    })
}

#[wasm_bindgen]
pub fn SessionBuilder_ProcessPreKeyBundle(
    bundle: &PreKeyBundle,
    protocol_address: &ProtocolAddress,
    local_address: &ProtocolAddress,
    session_store: JsValue,
    identity_key_store: JsValue,
    now: f64,
) -> Promise {
    let bundle = bundle.0.clone();
    let address = protocol_address.0.clone();
    let local_address = local_address.0.clone();
    future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        lsp::process_prekey_bundle(
            &address,
            &local_address,
            &mut JsStore(session_store),
            &mut JsStore(identity_key_store),
            &bundle,
            timestamp(now).into(),
            &mut rng,
        )
        .await
        .or_throw("SessionBuilder_ProcessPreKeyBundle")?;
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn SessionCipher_EncryptMessage(
    ptext: &[u8],
    protocol_address: &ProtocolAddress,
    local_address: &ProtocolAddress,
    session_store: JsValue,
    identity_key_store: JsValue,
    now: f64,
) -> Promise {
    let ptext = ptext.to_vec();
    let address = protocol_address.0.clone();
    let local_address = local_address.0.clone();
    future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let message = lsp::message_encrypt(
            &ptext,
            &address,
            &local_address,
            &mut JsStore(session_store),
            &mut JsStore(identity_key_store),
            timestamp(now).into(),
            &mut rng,
        )
        .await
        .or_throw("SessionCipher_EncryptMessage")?;
        Ok(CiphertextMessage(message).into())
    })
}

#[wasm_bindgen]
pub fn SessionCipher_DecryptSignalMessage(
    message: &SignalMessage,
    protocol_address: &ProtocolAddress,
    local_address: &ProtocolAddress,
    session_store: JsValue,
    identity_key_store: JsValue,
) -> Promise {
    let message = message.0.clone();
    let address = protocol_address.0.clone();
    let local_address = local_address.0.clone();
    future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let plaintext = lsp::message_decrypt_signal(
            &message,
            &address,
            &local_address,
            &mut JsStore(session_store),
            &mut JsStore(identity_key_store),
            &mut rng,
        )
        .await
        .or_throw("SessionCipher_DecryptSignalMessage")?;
        Ok(js_sys::Uint8Array::from(plaintext.as_slice()).into())
    })
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn SessionCipher_DecryptPreKeySignalMessage(
    message: &PreKeySignalMessage,
    protocol_address: &ProtocolAddress,
    local_address: &ProtocolAddress,
    session_store: JsValue,
    identity_key_store: JsValue,
    prekey_store: JsValue,
    signed_prekey_store: JsValue,
    kyber_prekey_store: JsValue,
) -> Promise {
    let message = message.0.clone();
    let address = protocol_address.0.clone();
    let local_address = local_address.0.clone();
    future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let result = lsp::message_decrypt_prekey(
            &message,
            &address,
            &local_address,
            &mut JsStore(session_store),
            &mut JsStore(identity_key_store),
            &mut JsStore(prekey_store),
            &JsStore(signed_prekey_store),
            &mut JsStore(kyber_prekey_store),
            &mut rng,
        )
        .await
        .or_throw("SessionCipher_DecryptPreKeySignalMessage")?;
        Ok(js_sys::Uint8Array::from(result.plaintext.as_slice()).into())
    })
}

#[wasm_bindgen]
pub fn SealedSender_Encrypt(
    destination: &ProtocolAddress,
    content: &UnidentifiedSenderMessageContent,
    identity_key_store: JsValue,
) -> JsResult<Promise> {
    let destination = destination.0.clone();
    // `UnidentifiedSenderMessageContent` is not `Clone`; round-trip it through its serialization
    let content = lsp::UnidentifiedSenderMessageContent::deserialize(
        content.0.serialized().or_throw("SealedSender_Encrypt")?,
    )
    .or_throw("SealedSender_Encrypt")?;
    Ok(future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let ciphertext = lsp::sealed_sender_encrypt_from_usmc(
            &destination,
            &content,
            &JsStore(identity_key_store),
            &mut rng,
        )
        .await
        .or_throw("SealedSender_Encrypt")?;
        Ok(js_sys::Uint8Array::from(ciphertext.as_slice()).into())
    }))
}

/// `excluded_recipients` is a concatenation of fixed-width service IDs.
#[wasm_bindgen]
pub fn SealedSender_MultiRecipientEncrypt(
    recipients: Vec<ProtocolAddress>,
    recipient_sessions: Vec<SessionRecord>,
    excluded_recipients: &[u8],
    content: &UnidentifiedSenderMessageContent,
    identity_key_store: JsValue,
) -> JsResult<Promise> {
    let operation = "SealedSender_MultiRecipientEncrypt";
    let excluded = excluded_recipients
        .chunks(SERVICE_ID_FIXED_WIDTH_LENGTH)
        .map(|chunk| {
            chunk
                .try_into()
                .ok()
                .and_then(ServiceId::parse_from_service_id_fixed_width_binary)
                .ok_or_else(|| {
                    protocol_error(
                        lsp::SignalProtocolError::InvalidArgument("invalid service ID".to_owned()),
                        operation,
                    )
                })
        })
        .collect::<JsResult<Vec<_>>>()?;
    let content = lsp::UnidentifiedSenderMessageContent::deserialize(
        content.0.serialized().or_throw(operation)?,
    )
    .or_throw(operation)?;
    Ok(future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let addresses: Vec<&lsp::ProtocolAddress> = recipients.iter().map(|r| &r.0).collect();
        let sessions: Vec<&lsp::SessionRecord> = recipient_sessions.iter().map(|s| &s.0).collect();
        let ciphertext = lsp::sealed_sender_multi_recipient_encrypt(
            &addresses,
            &sessions,
            excluded,
            &content,
            &JsStore(identity_key_store),
            &mut rng,
        )
        .await
        .or_throw(operation)?;
        Ok(js_sys::Uint8Array::from(ciphertext.as_slice()).into())
    }))
}

#[wasm_bindgen]
pub fn SealedSender_DecryptToUsmc(ctext: &[u8], identity_store: JsValue) -> Promise {
    let ctext = ctext.to_vec();
    future_to_promise(async move {
        let content = lsp::sealed_sender_decrypt_to_usmc(&ctext, &JsStore(identity_store))
            .await
            .or_throw("SealedSender_DecryptToUsmc")?;
        Ok(UnidentifiedSenderMessageContent(content).into())
    })
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_Create(
    sender: &ProtocolAddress,
    distribution_id: &[u8],
    store: JsValue,
) -> JsResult<Promise> {
    let operation = "SenderKeyDistributionMessage_Create";
    let sender = sender.0.clone();
    let distribution_id = uuid_from_bytes(distribution_id, operation)?;
    Ok(future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let message = lsp::create_sender_key_distribution_message(
            &sender,
            distribution_id,
            &mut JsStore(store),
            &mut rng,
        )
        .await
        .or_throw(operation)?;
        Ok(SenderKeyDistributionMessage(message).into())
    }))
}

#[wasm_bindgen]
pub fn SenderKeyDistributionMessage_Process(
    sender: &ProtocolAddress,
    message: &SenderKeyDistributionMessage,
    store: JsValue,
) -> Promise {
    let sender = sender.0.clone();
    let message = message.0.clone();
    future_to_promise(async move {
        lsp::process_sender_key_distribution_message(&sender, &message, &mut JsStore(store))
            .await
            .or_throw("SenderKeyDistributionMessage_Process")?;
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn GroupCipher_EncryptMessage(
    sender: &ProtocolAddress,
    distribution_id: &[u8],
    message: &[u8],
    store: JsValue,
) -> JsResult<Promise> {
    let operation = "GroupCipher_EncryptMessage";
    let sender = sender.0.clone();
    let distribution_id = uuid_from_bytes(distribution_id, operation)?;
    let message = message.to_vec();
    Ok(future_to_promise(async move {
        let mut rng = rand::rngs::OsRng.unwrap_err();
        let ciphertext = lsp::group_encrypt(
            &mut JsStore(store),
            &sender,
            distribution_id,
            &message,
            &mut rng,
        )
        .await
        .or_throw(operation)?;
        Ok(CiphertextMessage(lsp::CiphertextMessage::SenderKeyMessage(ciphertext)).into())
    }))
}

#[wasm_bindgen]
pub fn GroupCipher_DecryptMessage(sender: &ProtocolAddress, message: &[u8], store: JsValue) -> Promise {
    let sender = sender.0.clone();
    let message = message.to_vec();
    future_to_promise(async move {
        let plaintext = lsp::group_decrypt(&message, &mut JsStore(store), &sender)
            .await
            .or_throw("GroupCipher_DecryptMessage")?;
        Ok(js_sys::Uint8Array::from(plaintext.as_slice()).into())
    })
}
