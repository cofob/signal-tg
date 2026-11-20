//! Prekey, session and sender key records, prekey bundles

use libsignal_protocol::{self as lsp, GenericSignedPreKey as _};
use wasm_bindgen::prelude::*;

use crate::error::{JsResult, ProtocolResultExt};
use crate::handles::*;

pub(crate) fn timestamp(millis: f64) -> lsp::Timestamp {
    lsp::Timestamp::from_epoch_millis(millis as u64)
}

#[wasm_bindgen]
pub fn PreKeyRecord_New(id: u32, pub_key: &PublicKey, priv_key: &PrivateKey) -> PreKeyRecord {
    let key_pair = lsp::KeyPair::new(pub_key.0, priv_key.0);
    PreKeyRecord(lsp::PreKeyRecord::new(id.into(), &key_pair))
}

#[wasm_bindgen]
pub fn PreKeyRecord_Deserialize(data: &[u8]) -> JsResult<PreKeyRecord> {
    lsp::PreKeyRecord::deserialize(data)
        .map(PreKeyRecord)
        .or_throw("PreKeyRecord_Deserialize")
}

#[wasm_bindgen]
pub fn PreKeyRecord_Serialize(obj: &PreKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.serialize().or_throw("PreKeyRecord_Serialize")
}

#[wasm_bindgen]
pub fn PreKeyRecord_GetId(obj: &PreKeyRecord) -> JsResult<u32> {
    obj.0.id().map(u32::from).or_throw("PreKeyRecord_GetId")
}

#[wasm_bindgen]
pub fn PreKeyRecord_GetPublicKey(obj: &PreKeyRecord) -> JsResult<PublicKey> {
    obj.0.public_key().map(PublicKey).or_throw("PreKeyRecord_GetPublicKey")
}

#[wasm_bindgen]
pub fn PreKeyRecord_GetPrivateKey(obj: &PreKeyRecord) -> JsResult<PrivateKey> {
    obj.0.private_key().map(PrivateKey).or_throw("PreKeyRecord_GetPrivateKey")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_New(
    id: u32,
    timestamp_millis: f64,
    pub_key: &PublicKey,
    priv_key: &PrivateKey,
    signature: &[u8],
) -> SignedPreKeyRecord {
    let key_pair = lsp::KeyPair::new(pub_key.0, priv_key.0);
    SignedPreKeyRecord(lsp::SignedPreKeyRecord::new(
        id.into(),
        timestamp(timestamp_millis),
        &key_pair,
        signature,
    ))
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_Deserialize(data: &[u8]) -> JsResult<SignedPreKeyRecord> {
    lsp::SignedPreKeyRecord::deserialize(data)
        .map(SignedPreKeyRecord)
        .or_throw("SignedPreKeyRecord_Deserialize")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_Serialize(obj: &SignedPreKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.serialize().or_throw("SignedPreKeyRecord_Serialize")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_GetId(obj: &SignedPreKeyRecord) -> JsResult<u32> {
    obj.0.id().map(u32::from).or_throw("SignedPreKeyRecord_GetId")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_GetTimestamp(obj: &SignedPreKeyRecord) -> JsResult<f64> {
    obj.0
        .timestamp()
        .map(|t| t.epoch_millis() as f64)
        .or_throw("SignedPreKeyRecord_GetTimestamp")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_GetSignature(obj: &SignedPreKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.signature().or_throw("SignedPreKeyRecord_GetSignature")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_GetPublicKey(obj: &SignedPreKeyRecord) -> JsResult<PublicKey> {
    obj.0.public_key().map(PublicKey).or_throw("SignedPreKeyRecord_GetPublicKey")
}

#[wasm_bindgen]
pub fn SignedPreKeyRecord_GetPrivateKey(obj: &SignedPreKeyRecord) -> JsResult<PrivateKey> {
    obj.0.private_key().map(PrivateKey).or_throw("SignedPreKeyRecord_GetPrivateKey")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_New(
    id: u32,
    timestamp_millis: f64,
    key_pair: &KyberKeyPair,
    signature: &[u8],
) -> KyberPreKeyRecord {
    KyberPreKeyRecord(lsp::KyberPreKeyRecord::new(
        id.into(),
        timestamp(timestamp_millis),
        &key_pair.0,
        signature,
    ))
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_Deserialize(data: &[u8]) -> JsResult<KyberPreKeyRecord> {
    lsp::KyberPreKeyRecord::deserialize(data)
        .map(KyberPreKeyRecord)
        .or_throw("KyberPreKeyRecord_Deserialize")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_Serialize(obj: &KyberPreKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.serialize().or_throw("KyberPreKeyRecord_Serialize")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetId(obj: &KyberPreKeyRecord) -> JsResult<u32> {
    obj.0.id().map(u32::from).or_throw("KyberPreKeyRecord_GetId")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetTimestamp(obj: &KyberPreKeyRecord) -> JsResult<f64> {
    obj.0
        .timestamp()
        .map(|t| t.epoch_millis() as f64)
        .or_throw("KyberPreKeyRecord_GetTimestamp")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetSignature(obj: &KyberPreKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.signature().or_throw("KyberPreKeyRecord_GetSignature")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetPublicKey(obj: &KyberPreKeyRecord) -> JsResult<KyberPublicKey> {
    obj.0
        .public_key()
        .map(KyberPublicKey)
        .or_throw("KyberPreKeyRecord_GetPublicKey")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetSecretKey(obj: &KyberPreKeyRecord) -> JsResult<KyberSecretKey> {
    obj.0
        .secret_key()
        .map(KyberSecretKey)
        .or_throw("KyberPreKeyRecord_GetSecretKey")
}

#[wasm_bindgen]
pub fn KyberPreKeyRecord_GetKeyPair(obj: &KyberPreKeyRecord) -> JsResult<KyberKeyPair> {
    obj.0
        .key_pair()
        .map(KyberKeyPair)
        .or_throw("KyberPreKeyRecord_GetKeyPair")
}

#[wasm_bindgen]
pub fn SessionRecord_Deserialize(data: &[u8]) -> JsResult<SessionRecord> {
    lsp::SessionRecord::deserialize(data)
        .map(SessionRecord)
        .or_throw("SessionRecord_Deserialize")
}

#[wasm_bindgen]
pub fn SessionRecord_Serialize(obj: &SessionRecord) -> JsResult<Vec<u8>> {
    obj.0.serialize().or_throw("SessionRecord_Serialize")
}

#[wasm_bindgen]
pub fn SessionRecord_ArchiveCurrentState(obj: &mut SessionRecord) -> JsResult<()> {
    obj.0
        .archive_current_state()
        .or_throw("SessionRecord_ArchiveCurrentState")
}

#[wasm_bindgen]
pub fn SessionRecord_HasUsableSenderChain(obj: &SessionRecord, now: f64) -> JsResult<bool> {
    obj.0
        .has_usable_sender_chain(
            timestamp(now).into(),
            lsp::SessionUsabilityRequirements::NotStale
                | lsp::SessionUsabilityRequirements::EstablishedWithPqxdh
                | lsp::SessionUsabilityRequirements::Spqr,
        )
        .or_throw("SessionRecord_HasUsableSenderChain")
}

#[wasm_bindgen]
pub fn SessionRecord_CurrentRatchetKeyMatches(obj: &SessionRecord, key: &PublicKey) -> JsResult<bool> {
    obj.0
        .current_ratchet_key_matches(&key.0)
        .or_throw("SessionRecord_CurrentRatchetKeyMatches")
}

#[wasm_bindgen]
pub fn SessionRecord_GetLocalRegistrationId(obj: &SessionRecord) -> JsResult<u32> {
    obj.0
        .local_registration_id()
        .or_throw("SessionRecord_GetLocalRegistrationId")
}

#[wasm_bindgen]
pub fn SessionRecord_GetRemoteRegistrationId(obj: &SessionRecord) -> JsResult<u32> {
    obj.0
        .remote_registration_id()
        .or_throw("SessionRecord_GetRemoteRegistrationId")
}

#[wasm_bindgen]
pub fn SenderKeyRecord_Deserialize(data: &[u8]) -> JsResult<SenderKeyRecord> {
    lsp::SenderKeyRecord::deserialize(data)
        .map(SenderKeyRecord)
        .or_throw("SenderKeyRecord_Deserialize")
}

#[wasm_bindgen]
pub fn SenderKeyRecord_Serialize(obj: &SenderKeyRecord) -> JsResult<Vec<u8>> {
    obj.0.serialize().or_throw("SenderKeyRecord_Serialize")
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn PreKeyBundle_New(
    registration_id: u32,
    device_id: u32,
    prekey_id: Option<u32>,
    // Passed by value: `Native.ts` hands over a clone of the caller's handle
    prekey: Option<PublicKey>,
    signed_prekey_id: u32,
    signed_prekey: &PublicKey,
    signed_prekey_signature: &[u8],
    identity_key: &PublicKey,
    kyber_prekey_id: u32,
    kyber_prekey: &KyberPublicKey,
    kyber_prekey_signature: &[u8],
) -> JsResult<PreKeyBundle> {
    let device_id = device_id.try_into().map_err(|_| {
        crate::error::protocol_error(
            lsp::SignalProtocolError::InvalidArgument(format!("invalid device id {device_id}")),
            "PreKeyBundle_New",
        )
    })?;
    let prekey = match (prekey_id, prekey) {
        (Some(id), Some(key)) => Some((id.into(), key.0)),
        (None, None) => None,
        _ => {
            return Err(crate::error::protocol_error(
                lsp::SignalProtocolError::InvalidArgument(
                    "must set both prekey id and key or neither".to_owned(),
                ),
                "PreKeyBundle_New",
            ));
        }
    };
    lsp::PreKeyBundle::new(
        registration_id,
        device_id,
        prekey,
        signed_prekey_id.into(),
        signed_prekey.0,
        signed_prekey_signature.to_vec(),
        kyber_prekey_id.into(),
        kyber_prekey.0.clone(),
        kyber_prekey_signature.to_vec(),
        lsp::IdentityKey::new(identity_key.0),
    )
    .map(PreKeyBundle)
    .or_throw("PreKeyBundle_New")
}

#[wasm_bindgen]
pub fn PreKeyBundle_GetIdentityKey(obj: &PreKeyBundle) -> JsResult<PublicKey> {
    obj.0
        .identity_key()
        .map(|key| PublicKey(*key.public_key()))
        .or_throw("PreKeyBundle_GetIdentityKey")
}

#[wasm_bindgen]
pub fn PreKeyBundle_GetRegistrationId(obj: &PreKeyBundle) -> JsResult<u32> {
    obj.0.registration_id().or_throw("PreKeyBundle_GetRegistrationId")
}

#[wasm_bindgen]
pub fn PreKeyBundle_GetDeviceId(obj: &PreKeyBundle) -> JsResult<u32> {
    obj.0
        .device_id()
        .map(u32::from)
        .or_throw("PreKeyBundle_GetDeviceId")
}
