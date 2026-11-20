//! Keys of message backups, which link and sync uses to transfer message history to a new linked device
//! (upstream `rust/bridge/shared/src/account_keys.rs` and `message_backup.rs`).

use libsignal_account_keys::{BACKUP_FORWARD_SECRECY_TOKEN_LEN, BACKUP_KEY_LEN, BackupForwardSecrecyToken, BackupId, BackupKey};
use libsignal_message_backup::key::MessageBackupKey as MessageBackupKeyInner;
use wasm_bindgen::prelude::*;

use crate::error::{JsResult, generic_error};
use crate::zkgroup::aci;

#[wasm_bindgen]
pub struct MessageBackupKey(MessageBackupKeyInner);

fn backup_key(bytes: &[u8], operation: &str) -> JsResult<BackupKey> {
    let bytes: [u8; BACKUP_KEY_LEN] =
        bytes.try_into().map_err(|_| generic_error("invalid backup key length", operation))?;
    // The explicit type forces the latest version of the key derivation scheme
    Ok(BackupKey(bytes))
}

#[wasm_bindgen]
pub fn BackupKey_DeriveBackupId(backup_key_bytes: &[u8], aci_bytes: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "BackupKey_DeriveBackupId";
    let backup_key = backup_key(backup_key_bytes, operation)?;
    Ok(backup_key.derive_backup_id(&aci(aci_bytes, operation)?).0.to_vec())
}

#[wasm_bindgen]
pub fn MessageBackupKey_FromBackupKeyAndBackupId(
    backup_key_bytes: &[u8],
    backup_id: &[u8],
    forward_secrecy_token: Option<Vec<u8>>,
) -> JsResult<MessageBackupKey> {
    let operation = "MessageBackupKey_FromBackupKeyAndBackupId";
    let backup_key = backup_key(backup_key_bytes, operation)?;
    let backup_id = BackupId(
        backup_id.try_into().map_err(|_| generic_error("invalid backup ID length", operation))?,
    );
    let forward_secrecy_token = forward_secrecy_token
        .map(|bytes| {
            <[u8; BACKUP_FORWARD_SECRECY_TOKEN_LEN]>::try_from(bytes.as_slice())
                .map(BackupForwardSecrecyToken)
                .map_err(|_| generic_error("invalid forward secrecy token length", operation))
        })
        .transpose()?;
    Ok(MessageBackupKey(MessageBackupKeyInner::derive(
        &backup_key,
        &backup_id,
        forward_secrecy_token.as_ref(),
    )))
}

#[wasm_bindgen]
pub fn MessageBackupKey_GetHmacKey(key: &MessageBackupKey) -> Vec<u8> {
    key.0.hmac_key.to_vec()
}

#[wasm_bindgen]
pub fn MessageBackupKey_GetAesKey(key: &MessageBackupKey) -> Vec<u8> {
    key.0.aes_key.to_vec()
}
