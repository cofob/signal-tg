//! zkgroup operations for profiles and groups v2.
//!
//! As in the Node bridge, zkgroup values cross the boundary in their serialized form, except
//! `ServerPublicParams`, which is a handle. Service ids are 17-byte fixed-width binaries.

use libsignal_protocol::{Aci, Pni, ServiceId};
use partial_default::PartialDefault;
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;
use zkgroup::auth::{AuthCredentialWithPni, AuthCredentialWithPniResponse};
use zkgroup::groups::{GroupMasterKey, GroupPublicParams, GroupSecretParams, ProfileKeyCiphertext, UuidCiphertext};
use zkgroup::profiles::{
    ExpiringProfileKeyCredential, ExpiringProfileKeyCredentialResponse, ProfileKey,
    ProfileKeyCredentialRequestContext,
};
use zkgroup::{RANDOMNESS_LEN, Timestamp};

use crate::error::{JsResult, generic_error};

const SERVICE_ID_FIXED_WIDTH_LENGTH: usize = 17;
const GROUP_MASTER_KEY_LENGTH: usize = 32;

#[wasm_bindgen]
pub struct ServerPublicParams(zkgroup::ServerPublicParams);

fn decode<T: DeserializeOwned + PartialDefault>(bytes: &[u8], operation: &str) -> JsResult<T> {
    zkgroup::deserialize(bytes).map_err(|_| generic_error("invalid serialized zkgroup value", operation))
}

fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    zkgroup::serialize(value)
}

fn service_id(bytes: &[u8], operation: &str) -> JsResult<ServiceId> {
    let fixed: &[u8; SERVICE_ID_FIXED_WIDTH_LENGTH] =
        bytes.try_into().map_err(|_| generic_error("invalid service ID length", operation))?;
    ServiceId::parse_from_service_id_fixed_width_binary(fixed)
        .ok_or_else(|| generic_error("invalid service ID", operation))
}

fn aci(bytes: &[u8], operation: &str) -> JsResult<Aci> {
    Aci::try_from(service_id(bytes, operation)?).map_err(|_| generic_error("expected an ACI", operation))
}

fn pni(bytes: &[u8], operation: &str) -> JsResult<Pni> {
    Pni::try_from(service_id(bytes, operation)?).map_err(|_| generic_error("expected a PNI", operation))
}

fn randomness(bytes: &[u8], operation: &str) -> JsResult<[u8; RANDOMNESS_LEN]> {
    bytes.try_into().map_err(|_| generic_error("randomness must be 32 bytes", operation))
}

fn verification_failure(operation: &str) -> impl Fn(zkgroup::ZkGroupVerificationFailure) -> JsValue + '_ {
    move |error| generic_error(error, operation)
}

#[wasm_bindgen]
pub fn ServerPublicParams_Deserialize(data: &[u8]) -> JsResult<ServerPublicParams> {
    decode(data, "ServerPublicParams_Deserialize").map(ServerPublicParams)
}

#[wasm_bindgen]
pub fn ProfileKey_GetCommitment(profile_key: &[u8], user_id: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "ProfileKey_GetCommitment";
    let profile_key: ProfileKey = decode(profile_key, operation)?;
    Ok(encode(&profile_key.get_commitment(aci(user_id, operation)?)))
}

/// Returns the version as ASCII hex, the form used in `GET /v1/profile/{aci}/{version}`
#[wasm_bindgen]
pub fn ProfileKey_GetProfileKeyVersion(profile_key: &[u8], user_id: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "ProfileKey_GetProfileKeyVersion";
    let profile_key: ProfileKey = decode(profile_key, operation)?;
    Ok(encode(&profile_key.get_profile_key_version(aci(user_id, operation)?)))
}

#[wasm_bindgen]
pub fn ProfileKey_DeriveAccessKey(profile_key: &[u8]) -> JsResult<Vec<u8>> {
    let profile_key: ProfileKey = decode(profile_key, "ProfileKey_DeriveAccessKey")?;
    Ok(profile_key.derive_access_key().to_vec())
}

#[wasm_bindgen]
pub fn GroupSecretParams_GenerateDeterministic(randomness_bytes: &[u8]) -> JsResult<Vec<u8>> {
    let randomness = randomness(randomness_bytes, "GroupSecretParams_GenerateDeterministic")?;
    Ok(encode(&GroupSecretParams::generate(randomness)))
}

#[wasm_bindgen]
pub fn GroupSecretParams_DeriveFromMasterKey(master_key: &[u8]) -> JsResult<Vec<u8>> {
    let bytes: [u8; GROUP_MASTER_KEY_LENGTH] = master_key
        .try_into()
        .map_err(|_| generic_error("master key must be 32 bytes", "GroupSecretParams_DeriveFromMasterKey"))?;
    Ok(encode(&GroupSecretParams::derive_from_master_key(GroupMasterKey::new(bytes))))
}

#[wasm_bindgen]
pub fn GroupSecretParams_GetMasterKey(params: &[u8]) -> JsResult<Vec<u8>> {
    let params: GroupSecretParams = decode(params, "GroupSecretParams_GetMasterKey")?;
    Ok(encode(&params.get_master_key()))
}

#[wasm_bindgen]
pub fn GroupSecretParams_GetPublicParams(params: &[u8]) -> JsResult<Vec<u8>> {
    let params: GroupSecretParams = decode(params, "GroupSecretParams_GetPublicParams")?;
    Ok(encode(&params.get_public_params()))
}

#[wasm_bindgen]
pub fn GroupPublicParams_GetGroupIdentifier(params: &[u8]) -> JsResult<Vec<u8>> {
    let params: GroupPublicParams = decode(params, "GroupPublicParams_GetGroupIdentifier")?;
    Ok(params.get_group_identifier().to_vec())
}

#[wasm_bindgen]
pub fn GroupSecretParams_EncryptServiceId(params: &[u8], service_id_bytes: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_EncryptServiceId";
    let params: GroupSecretParams = decode(params, operation)?;
    Ok(encode(&params.encrypt_service_id(service_id(service_id_bytes, operation)?)))
}

/// Returns the fixed-width service ID binary
#[wasm_bindgen]
pub fn GroupSecretParams_DecryptServiceId(params: &[u8], ciphertext: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_DecryptServiceId";
    let params: GroupSecretParams = decode(params, operation)?;
    let ciphertext: UuidCiphertext = decode(ciphertext, operation)?;
    let service_id = params
        .decrypt_service_id(ciphertext)
        .map_err(verification_failure(operation))?;
    Ok(service_id.service_id_fixed_width_binary().to_vec())
}

#[wasm_bindgen]
pub fn GroupSecretParams_EncryptProfileKey(params: &[u8], profile_key: &[u8], user_id: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_EncryptProfileKey";
    let params: GroupSecretParams = decode(params, operation)?;
    let profile_key: ProfileKey = decode(profile_key, operation)?;
    Ok(encode(&params.encrypt_profile_key(profile_key, aci(user_id, operation)?)))
}

#[wasm_bindgen]
pub fn GroupSecretParams_DecryptProfileKey(params: &[u8], ciphertext: &[u8], user_id: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_DecryptProfileKey";
    let params: GroupSecretParams = decode(params, operation)?;
    let ciphertext: ProfileKeyCiphertext = decode(ciphertext, operation)?;
    let profile_key = params
        .decrypt_profile_key(ciphertext, aci(user_id, operation)?)
        .map_err(verification_failure(operation))?;
    Ok(encode(&profile_key))
}

#[wasm_bindgen]
pub fn GroupSecretParams_EncryptBlobWithPaddingDeterministic(
    params: &[u8],
    randomness_bytes: &[u8],
    plaintext: &[u8],
    padding_len: u32,
) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_EncryptBlobWithPaddingDeterministic";
    let params: GroupSecretParams = decode(params, operation)?;
    Ok(params.encrypt_blob_with_padding(randomness(randomness_bytes, operation)?, plaintext, padding_len))
}

#[wasm_bindgen]
pub fn GroupSecretParams_DecryptBlobWithPadding(params: &[u8], ciphertext: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSecretParams_DecryptBlobWithPadding";
    let params: GroupSecretParams = decode(params, operation)?;
    params
        .decrypt_blob_with_padding(ciphertext)
        .map_err(verification_failure(operation))
}

/// `redemption_time` is in seconds, as in `GET /v1/certificate/auth/group`
#[wasm_bindgen]
pub fn ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId(
    params: &ServerPublicParams,
    aci_bytes: &[u8],
    pni_bytes: &[u8],
    redemption_time: f64,
    response: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_ReceiveAuthCredentialWithPniAsServiceId";
    let response = AuthCredentialWithPniResponse::new(response)
        .map_err(|_| generic_error("invalid auth credential response", operation))?;
    let credential = response
        .receive(
            &params.0,
            aci(aci_bytes, operation)?,
            pni(pni_bytes, operation)?,
            Timestamp::from_epoch_seconds(redemption_time as u64),
        )
        .map_err(verification_failure(operation))?;
    Ok(encode(&credential))
}

#[wasm_bindgen]
pub fn ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic(
    params: &ServerPublicParams,
    randomness_bytes: &[u8],
    group_secret_params: &[u8],
    auth_credential: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_CreateAuthCredentialWithPniPresentationDeterministic";
    let group_secret_params: GroupSecretParams = decode(group_secret_params, operation)?;
    let credential = AuthCredentialWithPni::new(auth_credential)
        .map_err(|_| generic_error("invalid auth credential", operation))?;
    Ok(encode(&credential.present(
        &params.0,
        &group_secret_params,
        randomness(randomness_bytes, operation)?,
    )))
}

#[wasm_bindgen]
pub fn ServerPublicParams_CreateProfileKeyCredentialRequestContextDeterministic(
    params: &ServerPublicParams,
    randomness_bytes: &[u8],
    user_id: &[u8],
    profile_key: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_CreateProfileKeyCredentialRequestContextDeterministic";
    let profile_key: ProfileKey = decode(profile_key, operation)?;
    Ok(encode(&params.0.create_profile_key_credential_request_context(
        randomness(randomness_bytes, operation)?,
        aci(user_id, operation)?,
        profile_key,
    )))
}

#[wasm_bindgen]
pub fn ProfileKeyCredentialRequestContext_GetRequest(context: &[u8]) -> JsResult<Vec<u8>> {
    let context: ProfileKeyCredentialRequestContext =
        decode(context, "ProfileKeyCredentialRequestContext_GetRequest")?;
    Ok(encode(&context.get_request()))
}

/// `current_time` is in seconds
#[wasm_bindgen]
pub fn ServerPublicParams_ReceiveExpiringProfileKeyCredential(
    params: &ServerPublicParams,
    request_context: &[u8],
    response: &[u8],
    current_time: f64,
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_ReceiveExpiringProfileKeyCredential";
    let request_context: ProfileKeyCredentialRequestContext = decode(request_context, operation)?;
    let response: ExpiringProfileKeyCredentialResponse = decode(response, operation)?;
    let credential = params
        .0
        .receive_expiring_profile_key_credential(
            &request_context,
            &response,
            Timestamp::from_epoch_seconds(current_time as u64),
        )
        .map_err(verification_failure(operation))?;
    Ok(encode(&credential))
}

/// Returns seconds since the epoch
#[wasm_bindgen]
pub fn ExpiringProfileKeyCredential_GetExpirationTime(credential: &[u8]) -> JsResult<f64> {
    let credential: ExpiringProfileKeyCredential =
        decode(credential, "ExpiringProfileKeyCredential_GetExpirationTime")?;
    Ok(credential.get_expiration_time().epoch_seconds() as f64)
}

#[wasm_bindgen]
pub fn ServerPublicParams_CreateExpiringProfileKeyCredentialPresentationDeterministic(
    params: &ServerPublicParams,
    randomness_bytes: &[u8],
    group_secret_params: &[u8],
    credential: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_CreateExpiringProfileKeyCredentialPresentationDeterministic";
    let group_secret_params: GroupSecretParams = decode(group_secret_params, operation)?;
    let credential: ExpiringProfileKeyCredential = decode(credential, operation)?;
    Ok(encode(&params.0.create_expiring_profile_key_credential_presentation(
        randomness(randomness_bytes, operation)?,
        group_secret_params,
        credential,
    )))
}
