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
use zkgroup::backups::{BackupAuthCredential, BackupAuthCredentialRequestContext, BackupAuthCredentialResponse};
use zkgroup::generic_server_params::GenericServerPublicParams;
use zkgroup::groups::{
    GroupMasterKey, GroupPublicParams, GroupSecretParams, GroupSendEndorsement, GroupSendEndorsementsResponse,
    GroupSendToken, ProfileKeyCiphertext, UuidCiphertext,
};
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

pub(crate) fn aci(bytes: &[u8], operation: &str) -> JsResult<Aci> {
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

/// Verifies the server's notary signature, such as `GroupChange.serverSignature` over its actions
#[wasm_bindgen]
pub fn ServerPublicParams_VerifySignature(
    params: &ServerPublicParams,
    message: &[u8],
    notary_signature: &[u8],
) -> JsResult<()> {
    let operation = "ServerPublicParams_VerifySignature";
    let signature = notary_signature
        .try_into()
        .map_err(|_| generic_error("invalid notary signature length", operation))?;
    params
        .0
        .verify_signature(message, signature)
        .map_err(verification_failure(operation))
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

/// For accounts without a phone number: the credential is bound to the provisioning message's
/// auth credential salt instead of a PNI
#[wasm_bindgen]
pub fn ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni(
    params: &ServerPublicParams,
    aci_bytes: &[u8],
    salt: &[u8],
    redemption_time: f64,
    response: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "ServerPublicParams_ReceiveAuthCredentialZkcWithoutPni";
    let response = AuthCredentialWithPniResponse::new(response)
        .map_err(|_| generic_error("invalid auth credential response", operation))?;
    let credential = response
        .receive_without_pni(
            &params.0,
            aci(aci_bytes, operation)?,
            salt,
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

/// Returns seconds since the epoch
#[wasm_bindgen]
pub fn GroupSendEndorsementsResponse_GetExpiration(response: &[u8]) -> JsResult<f64> {
    let response: GroupSendEndorsementsResponse = decode(response, "GroupSendEndorsementsResponse_GetExpiration")?;
    Ok(response.expiration().epoch_seconds() as f64)
}

/// Verifies the endorsements of `group_members` (concatenated service IDs that include `local_user`) at
/// `now` in seconds. Returns each member's endorsement in the order of `group_members`, then the combined
/// endorsement of everyone but `local_user`.
#[wasm_bindgen]
pub fn GroupSendEndorsementsResponse_ReceiveAndCombineWithServiceIds(
    response: &[u8],
    group_members: &[u8],
    local_user: &[u8],
    now: f64,
    group_params: &[u8],
    server_params: &ServerPublicParams,
) -> JsResult<Vec<js_sys::Uint8Array>> {
    let operation = "GroupSendEndorsementsResponse_ReceiveAndCombineWithServiceIds";
    let response: GroupSendEndorsementsResponse = decode(response, operation)?;
    let group_params: GroupSecretParams = decode(group_params, operation)?;
    let local_user = service_id(local_user, operation)?;
    let members = group_members
        .chunks(SERVICE_ID_FIXED_WIDTH_LENGTH)
        .map(|chunk| service_id(chunk, operation))
        .collect::<JsResult<Vec<_>>>()?;
    let local_user_index = members
        .iter()
        .position(|member| *member == local_user)
        .ok_or_else(|| generic_error("local user not included in member list", operation))?;

    // `receive_with_service_ids` parallelizes with rayon, which has no threads in WebAssembly
    let endorsements = response
        .receive_with_service_ids_single_threaded(
            members,
            Timestamp::from_epoch_seconds(now as u64),
            &group_params,
            &server_params.0,
        )
        .map_err(verification_failure(operation))?;
    let combined = GroupSendEndorsement::combine(
        endorsements[..local_user_index]
            .iter()
            .chain(&endorsements[local_user_index + 1..])
            .map(|received| received.decompressed),
    );
    Ok(endorsements
        .iter()
        .map(|received| encode(&received.compressed))
        .chain([encode(&combined.compress())])
        .map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()))
        .collect())
}

#[wasm_bindgen]
pub fn GroupSendEndorsement_Combine(endorsements: Vec<js_sys::Uint8Array>) -> JsResult<Vec<u8>> {
    let operation = "GroupSendEndorsement_Combine";
    let endorsements = endorsements
        .iter()
        .map(|bytes| decode::<GroupSendEndorsement>(&bytes.to_vec(), operation))
        .collect::<JsResult<Vec<_>>>()?;
    Ok(encode(&GroupSendEndorsement::combine(endorsements)))
}

#[wasm_bindgen]
pub fn GroupSendEndorsement_Remove(endorsement: &[u8], to_remove: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSendEndorsement_Remove";
    let endorsement: GroupSendEndorsement = decode(endorsement, operation)?;
    let to_remove: GroupSendEndorsement = decode(to_remove, operation)?;
    Ok(encode(&endorsement.remove(&to_remove)))
}

#[wasm_bindgen]
pub fn GroupSendEndorsement_ToToken(endorsement: &[u8], group_params: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "GroupSendEndorsement_ToToken";
    let endorsement: GroupSendEndorsement = decode(endorsement, operation)?;
    let group_params: GroupSecretParams = decode(group_params, operation)?;
    Ok(encode(&endorsement.to_token(group_params)))
}

/// `expiration` is in seconds
#[wasm_bindgen]
pub fn GroupSendToken_ToFullToken(token: &[u8], expiration: f64) -> JsResult<Vec<u8>> {
    let token: GroupSendToken = decode(token, "GroupSendToken_ToFullToken")?;
    Ok(encode(&token.into_full_token(Timestamp::from_epoch_seconds(expiration as u64))))
}

/// Backup credentials: the context of a backup key and ACI requests a credential (`PUT /v1/archives/backupid`),
/// receives the server's response (`GET /v1/archives/auth`) and presents the credential to the backup service
#[wasm_bindgen]
pub fn BackupAuthCredentialRequestContext_New(backup_key: &[u8], uuid: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "BackupAuthCredentialRequestContext_New";
    let backup_key: libsignal_account_keys::BackupKey = libsignal_account_keys::BackupKey(
        backup_key.try_into().map_err(|_| generic_error("invalid backup key length", operation))?,
    );
    let uuid = uuid::Uuid::from_slice(uuid).map_err(|_| generic_error("invalid UUID length", operation))?;
    Ok(encode(&BackupAuthCredentialRequestContext::new(&backup_key, uuid.into())))
}

#[wasm_bindgen]
pub fn BackupAuthCredentialRequestContext_GetRequest(context_bytes: &[u8]) -> JsResult<Vec<u8>> {
    let context: BackupAuthCredentialRequestContext =
        decode(context_bytes, "BackupAuthCredentialRequestContext_GetRequest")?;
    Ok(encode(&context.get_request()))
}

/// `expected_redemption_time` is in seconds, as in `GET /v1/archives/auth`
#[wasm_bindgen]
pub fn BackupAuthCredentialRequestContext_ReceiveResponse(
    context_bytes: &[u8],
    response_bytes: &[u8],
    expected_redemption_time: f64,
    params_bytes: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "BackupAuthCredentialRequestContext_ReceiveResponse";
    let context: BackupAuthCredentialRequestContext = decode(context_bytes, operation)?;
    let response: BackupAuthCredentialResponse = decode(response_bytes, operation)?;
    let params = GenericServerPublicParams::try_from(params_bytes)
        .map_err(|_| generic_error("invalid generic server public params", operation))?;
    let credential = context
        .receive(response, &params, Timestamp::from_epoch_seconds(expected_redemption_time as u64))
        .map_err(verification_failure(operation))?;
    Ok(encode(&credential))
}

#[wasm_bindgen]
pub fn BackupAuthCredential_GetBackupLevel(credential_bytes: &[u8]) -> JsResult<u8> {
    let credential: BackupAuthCredential = decode(credential_bytes, "BackupAuthCredential_GetBackupLevel")?;
    Ok(credential.backup_level() as u8)
}

#[wasm_bindgen]
pub fn BackupAuthCredential_PresentDeterministic(
    credential_bytes: &[u8],
    server_params_bytes: &[u8],
    randomness_bytes: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "BackupAuthCredential_PresentDeterministic";
    let credential: BackupAuthCredential = decode(credential_bytes, operation)?;
    let server_params = GenericServerPublicParams::try_from(server_params_bytes)
        .map_err(|_| generic_error("invalid generic server public params", operation))?;
    Ok(encode(&credential.present(&server_params, randomness(randomness_bytes, operation)?)))
}

#[cfg(test)]
mod backup_credential_tests {
    use zkgroup::backups::{BackupAuthCredentialPresentation, BackupAuthCredentialRequest, BackupCredentialType, BackupLevel};
    use zkgroup::generic_server_params::{GenericServerSecretParams, GenericServerSecretParamsLegacy};

    use super::*;

    const BACKUP_KEY: [u8; 32] = [3; 32];
    const ACI_UUID: [u8; 16] = [5; 16];
    const REDEMPTION_DAY_SECONDS: u64 = 20_000 * 86_400;

    /// The server side of `PUT /v1/archives/backupid` and `GET /v1/archives/auth`: issue a credential for the request
    #[test]
    fn a_backup_credential_is_issued_received_and_presented() {
        let secret: GenericServerSecretParams = GenericServerSecretParamsLegacy::generate([1; RANDOMNESS_LEN]).into();
        let public_bytes = zkgroup::serialize(&secret.get_public_params());

        let context = BackupAuthCredentialRequestContext_New(&BACKUP_KEY, &ACI_UUID).expect("context");
        let request_bytes = BackupAuthCredentialRequestContext_GetRequest(&context).expect("request");
        let request: BackupAuthCredentialRequest = decode(&request_bytes, "test").expect("request decodes");
        let response = request.issue(
            Timestamp::from_epoch_seconds(REDEMPTION_DAY_SECONDS),
            BackupLevel::Free,
            BackupCredentialType::Messages,
            &secret,
            [2; RANDOMNESS_LEN],
        );

        let credential = BackupAuthCredentialRequestContext_ReceiveResponse(
            &context,
            &encode(&response),
            REDEMPTION_DAY_SECONDS as f64,
            &public_bytes,
        )
        .expect("credential");
        assert_eq!(BackupAuthCredential_GetBackupLevel(&credential).expect("level"), BackupLevel::Free as u8);

        let presentation_bytes =
            BackupAuthCredential_PresentDeterministic(&credential, &public_bytes, &[9; RANDOMNESS_LEN]).expect("presentation");
        let presentation: BackupAuthCredentialPresentation = decode(&presentation_bytes, "test").expect("decodes");
        presentation
            .verify(Timestamp::from_epoch_seconds(REDEMPTION_DAY_SECONDS), &secret)
            .expect("the server accepts the presentation");
    }
}
