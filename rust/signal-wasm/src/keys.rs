//! Curve25519 and Kyber keys, addresses and HKDF

use js_sys::Array;
use libsignal_protocol as lsp;
use rand::TryRngCore as _;
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt, JsResult, ProtocolResultExt, new_address};
use crate::handles::*;

const KYBER_KEY_TYPE: lsp::kem::KeyType = lsp::kem::KeyType::Kyber1024;

#[wasm_bindgen]
pub fn ProtocolAddress_New(name: String, device_id: u32) -> JsResult<ProtocolAddress> {
    new_address(name, device_id)
        .map(ProtocolAddress)
        .or_throw("ProtocolAddress_New")
}

#[wasm_bindgen]
pub fn ProtocolAddress_Name(obj: &ProtocolAddress) -> String {
    obj.0.name().to_owned()
}

#[wasm_bindgen]
pub fn ProtocolAddress_DeviceId(obj: &ProtocolAddress) -> u32 {
    obj.0.device_id().into()
}

#[wasm_bindgen]
pub fn PrivateKey_Generate() -> PrivateKey {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    PrivateKey(lsp::KeyPair::generate(&mut rng).private_key)
}

#[wasm_bindgen]
pub fn PrivateKey_Deserialize(data: &[u8]) -> JsResult<PrivateKey> {
    lsp::PrivateKey::deserialize(data)
        .map(PrivateKey)
        .map_err(lsp::SignalProtocolError::from)
        .or_throw("PrivateKey_Deserialize")
}

#[wasm_bindgen]
pub fn PrivateKey_Serialize(obj: &PrivateKey) -> Vec<u8> {
    obj.0.serialize()
}

#[wasm_bindgen]
pub fn PrivateKey_GetPublicKey(key: &PrivateKey) -> JsResult<PublicKey> {
    key.0
        .public_key()
        .map(PublicKey)
        .map_err(lsp::SignalProtocolError::from)
        .or_throw("PrivateKey_GetPublicKey")
}

#[wasm_bindgen]
pub fn PrivateKey_Sign(key: &PrivateKey, message: &[u8]) -> JsResult<Vec<u8>> {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    key.0
        .calculate_signature(message, &mut rng)
        .map(Vec::from)
        .map_err(lsp::SignalProtocolError::from)
        .or_throw("PrivateKey_Sign")
}

#[wasm_bindgen]
pub fn PrivateKey_Agree(private_key: &PrivateKey, public_key: &PublicKey) -> JsResult<Vec<u8>> {
    private_key
        .0
        .calculate_agreement(&public_key.0)
        .map(Vec::from)
        .map_err(lsp::SignalProtocolError::from)
        .or_throw("PrivateKey_Agree")
}

#[wasm_bindgen]
pub fn PublicKey_Deserialize(data: &[u8]) -> JsResult<PublicKey> {
    lsp::PublicKey::deserialize(data)
        .map(PublicKey)
        .map_err(lsp::SignalProtocolError::from)
        .or_throw("PublicKey_Deserialize")
}

#[wasm_bindgen]
pub fn PublicKey_Serialize(obj: &PublicKey) -> Vec<u8> {
    obj.0.serialize().into_vec()
}

#[wasm_bindgen]
pub fn PublicKey_GetPublicKeyBytes(obj: &PublicKey) -> Vec<u8> {
    obj.0.public_key_bytes().to_vec()
}

#[wasm_bindgen]
pub fn PublicKey_Equals(lhs: &PublicKey, rhs: &PublicKey) -> bool {
    lhs.0 == rhs.0
}

#[wasm_bindgen]
pub fn PublicKey_Verify(key: &PublicKey, message: &[u8], signature: &[u8]) -> bool {
    key.0.verify_signature(message, signature)
}

#[wasm_bindgen]
pub fn IdentityKeyPair_Serialize(public_key: &PublicKey, private_key: &PrivateKey) -> Vec<u8> {
    lsp::IdentityKeyPair::new(lsp::IdentityKey::new(public_key.0), private_key.0)
        .serialize()
        .into_vec()
}

#[wasm_bindgen]
pub fn IdentityKeyPair_Deserialize(input: &[u8]) -> JsResult<Array> {
    let pair = lsp::IdentityKeyPair::try_from(input).or_throw("IdentityKeyPair_Deserialize")?;
    Ok(Array::of2(
        &PublicKey(*pair.public_key()).into(),
        &PrivateKey(*pair.private_key()).into(),
    ))
}

#[wasm_bindgen]
pub fn IdentityKeyPair_SignAlternateIdentity(
    public_key: &PublicKey,
    private_key: &PrivateKey,
    other_identity: &PublicKey,
) -> JsResult<Vec<u8>> {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    lsp::IdentityKeyPair::new(lsp::IdentityKey::new(public_key.0), private_key.0)
        .sign_alternate_identity(&lsp::IdentityKey::new(other_identity.0), &mut rng)
        .map(Vec::from)
        .or_throw("IdentityKeyPair_SignAlternateIdentity")
}

#[wasm_bindgen]
pub fn KyberKeyPair_Generate() -> KyberKeyPair {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    KyberKeyPair(lsp::kem::KeyPair::generate(KYBER_KEY_TYPE, &mut rng))
}

#[wasm_bindgen]
pub fn KyberKeyPair_GetPublicKey(key_pair: &KyberKeyPair) -> KyberPublicKey {
    KyberPublicKey(key_pair.0.public_key.clone())
}

#[wasm_bindgen]
pub fn KyberKeyPair_GetSecretKey(key_pair: &KyberKeyPair) -> KyberSecretKey {
    KyberSecretKey(key_pair.0.secret_key.clone())
}

#[wasm_bindgen]
pub fn KyberPublicKey_Deserialize(data: &[u8]) -> JsResult<KyberPublicKey> {
    lsp::kem::PublicKey::deserialize(data)
        .map(KyberPublicKey)
        .or_throw("KyberPublicKey_Deserialize")
}

#[wasm_bindgen]
pub fn KyberPublicKey_Serialize(obj: &KyberPublicKey) -> Vec<u8> {
    obj.0.serialize().into_vec()
}

#[wasm_bindgen]
pub fn KyberPublicKey_Equals(lhs: &KyberPublicKey, rhs: &KyberPublicKey) -> bool {
    lhs.0 == rhs.0
}

#[wasm_bindgen]
pub fn KyberSecretKey_Deserialize(data: &[u8]) -> JsResult<KyberSecretKey> {
    lsp::kem::SecretKey::deserialize(data)
        .map(KyberSecretKey)
        .or_throw("KyberSecretKey_Deserialize")
}

#[wasm_bindgen]
pub fn KyberSecretKey_Serialize(obj: &KyberSecretKey) -> Vec<u8> {
    obj.0.serialize().into_vec()
}

#[wasm_bindgen]
pub fn HKDF_DeriveSecrets(
    output_length: u32,
    ikm: &[u8],
    label: Option<Vec<u8>>,
    salt: Option<Vec<u8>>,
) -> JsResult<Vec<u8>> {
    let mut output = vec![0; output_length as usize];
    hkdf::Hkdf::<sha2::Sha256>::new(salt.as_deref(), ikm)
        .expand(label.as_deref().unwrap_or_default(), &mut output)
        .map_err(|_| {
            crate::error::generic_error("output too long", "HKDF_DeriveSecrets")
        })?;
    Ok(output)
}

#[wasm_bindgen]
pub fn Fingerprint_New(
    iterations: u32,
    version: u32,
    local_identifier: &[u8],
    local_key: &PublicKey,
    remote_identifier: &[u8],
    remote_key: &PublicKey,
) -> JsResult<Fingerprint> {
    lsp::Fingerprint::new(
        version,
        iterations,
        local_identifier,
        &lsp::IdentityKey::new(local_key.0),
        remote_identifier,
        &lsp::IdentityKey::new(remote_key.0),
    )
    .map(Fingerprint)
    .or_throw_generic("Fingerprint_New")
}

#[wasm_bindgen]
pub fn Fingerprint_ScannableEncoding(obj: &Fingerprint) -> JsResult<Vec<u8>> {
    obj.0
        .scannable
        .serialize()
        .or_throw_generic("Fingerprint_ScannableEncoding")
}

#[wasm_bindgen]
pub fn Fingerprint_DisplayString(obj: &Fingerprint) -> JsResult<String> {
    obj.0
        .display_string()
        .map_err(|error| crate::error::generic_error(error, "Fingerprint_DisplayString"))
}

#[wasm_bindgen]
pub fn ScannableFingerprint_Compare(fprint1: &[u8], fprint2: &[u8]) -> JsResult<bool> {
    lsp::ScannableFingerprint::deserialize(fprint1)
        .and_then(|fingerprint| fingerprint.compare(fprint2))
        .map_err(|error| crate::error::generic_error(error, "ScannableFingerprint_Compare"))
}
