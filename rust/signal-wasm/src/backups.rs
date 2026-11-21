//! Message backups: their keys, the sizing of the padded compression, and the validator that checks the frames
//! of a backup before it is uploaded (upstream `rust/bridge/shared/src/account_keys.rs` and `message_backup.rs`).

use libsignal_account_keys::{
    BACKUP_FORWARD_SECRECY_TOKEN_LEN, BACKUP_KEY_LEN, BackupForwardSecrecyToken, BackupId, BackupKey,
};
use libsignal_message_backup::backup::{CompletedBackup, PartialBackup, Purpose, ValidateOnly};
use libsignal_message_backup::key::MessageBackupKey as MessageBackupKeyInner;
use rand::TryRngCore as _;
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt, JsResult, generic_error};
use crate::handles::PrivateKey;
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

fn message_backup_key(
    backup_key: &BackupKey,
    backup_id: &BackupId,
    forward_secrecy_token: Option<Vec<u8>>,
    operation: &str,
) -> JsResult<MessageBackupKey> {
    let forward_secrecy_token = forward_secrecy_token
        .map(|bytes| {
            <[u8; BACKUP_FORWARD_SECRECY_TOKEN_LEN]>::try_from(bytes.as_slice())
                .map(BackupForwardSecrecyToken)
                .map_err(|_| generic_error("invalid forward secrecy token length", operation))
        })
        .transpose()?;
    Ok(MessageBackupKey(MessageBackupKeyInner::derive(backup_key, backup_id, forward_secrecy_token.as_ref())))
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
    message_backup_key(&backup_key, &backup_id, forward_secrecy_token, operation)
}

#[wasm_bindgen]
pub fn MessageBackupKey_GetHmacKey(key: &MessageBackupKey) -> Vec<u8> {
    key.0.hmac_key.to_vec()
}

#[wasm_bindgen]
pub fn MessageBackupKey_GetAesKey(key: &MessageBackupKey) -> Vec<u8> {
    key.0.aes_key.to_vec()
}

#[wasm_bindgen]
pub fn BackupKey_DeriveEcKey(backup_key_bytes: &[u8], aci_bytes: &[u8]) -> JsResult<PrivateKey> {
    let operation = "BackupKey_DeriveEcKey";
    let backup_key = backup_key(backup_key_bytes, operation)?;
    Ok(PrivateKey(backup_key.derive_ec_key(&aci(aci_bytes, operation)?)))
}

#[wasm_bindgen]
pub fn MessageBackupSizing_FlushInterval(uncompressed_len: u64, estimated_total_uncompressed_len: u64) -> u64 {
    let estimate = (estimated_total_uncompressed_len != 0).then_some(estimated_total_uncompressed_len);
    libsignal_message_backup::padding::flush_interval(uncompressed_len, estimate)
}

#[wasm_bindgen]
pub fn MessageBackupSizing_PaddingSize(max_interval_bytes: u64, compressed_len: u64) -> u64 {
    libsignal_message_backup::padding::padding_size(
        max_interval_bytes,
        compressed_len,
        &mut rand::rngs::OsRng.unwrap_err(),
    )
}

/// Checks the frames of a backup as they are added, without holding them
/// (upstream `OnlineBackupValidator` in `rust/bridge/shared/types/src/message_backup.rs`)
#[wasm_bindgen]
pub struct OnlineBackupValidator {
    backup: Option<PartialBackup<ValidateOnly>>,
}

#[wasm_bindgen]
pub fn OnlineBackupValidator_New(backup_info_frame: &[u8], purpose: u8) -> JsResult<OnlineBackupValidator> {
    let operation = "OnlineBackupValidator_New";
    let purpose = Purpose::try_from(purpose).or_throw_generic(operation)?;
    let backup = PartialBackup::by_parsing(backup_info_frame, purpose, |_| ()).or_throw_generic(operation)?;
    Ok(OnlineBackupValidator { backup: Some(backup) })
}

#[wasm_bindgen]
pub fn OnlineBackupValidator_AddFrame(backup: &mut OnlineBackupValidator, frame: &[u8]) -> JsResult<()> {
    let operation = "OnlineBackupValidator_AddFrame";
    let partial = backup.backup.as_mut().ok_or_else(|| generic_error("validator is finalized", operation))?;
    partial.parse_and_add_frame(frame, |_| ()).map(|_| ()).or_throw_generic(operation)
}

#[wasm_bindgen]
pub fn OnlineBackupValidator_Finalize(backup: &mut OnlineBackupValidator) -> JsResult<()> {
    let operation = "OnlineBackupValidator_Finalize";
    let partial = backup.backup.take().ok_or_else(|| generic_error("validator is finalized", operation))?;
    CompletedBackup::try_from(partial).map(|_| ()).or_throw_generic(operation)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEDIA_ROOT_KEY_LEN: usize = 32;
    const PROFILE_KEY_LEN: usize = 32;
    const PURPOSE_REMOTE_BACKUP: u8 = 1;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut bytes = Vec::new();
        while value >= 0x80 {
            bytes.push((value & 0x7f) as u8 | 0x80);
            value >>= 7;
        }
        bytes.push(value as u8);
        bytes
    }

    fn field(number: u64, bytes: &[u8]) -> Vec<u8> {
        let mut out = varint(number << 3 | 2);
        out.extend(varint(bytes.len() as u64));
        out.extend_from_slice(bytes);
        out
    }

    fn backup_info() -> Vec<u8> {
        let mut info = varint(1 << 3);
        info.extend(varint(1));
        info.extend(varint(2 << 3));
        info.extend(varint(1_700_000_000_000));
        info.extend(field(3, &[7; MEDIA_ROOT_KEY_LEN]));
        info
    }

    fn account_frame() -> Vec<u8> {
        // `Frame.account` (1) holding `AccountData.profileKey` (1) and `accountSettings` (9)
        let mut account = field(1, &[9; PROFILE_KEY_LEN]);
        // The enums of `AccountSettings` must be known: phone number sharing (17), sent media quality (23), app theme
        // (28), calls data setting (29) and unread badge type (33)
        let mut settings = Vec::new();
        for number in [17, 23, 28, 29, 33] {
            settings.extend(varint(number << 3));
            settings.extend(varint(1));
        }
        account.extend(field(9, &settings));
        field(1, &account)
    }

    fn self_recipient_frame() -> Vec<u8> {
        // `Frame.recipient` (2): `Recipient.id` (1) and the empty `Recipient.self` (5)
        let mut recipient = varint(1 << 3);
        recipient.extend(varint(1));
        recipient.extend(field(5, &[]));
        field(2, &recipient)
    }

    #[test]
    fn validator_accepts_a_backup_with_account_data_and_self() {
        let mut validator = OnlineBackupValidator_New(&backup_info(), PURPOSE_REMOTE_BACKUP).expect("valid info");
        OnlineBackupValidator_AddFrame(&mut validator, &account_frame()).expect("valid account");
        OnlineBackupValidator_AddFrame(&mut validator, &self_recipient_frame()).expect("valid self recipient");
        OnlineBackupValidator_Finalize(&mut validator).expect("complete backup");
    }

    #[test]
    fn validator_rejects_a_backup_without_account_data() {
        let mut validator = OnlineBackupValidator_New(&backup_info(), PURPOSE_REMOTE_BACKUP).expect("valid info");
        let partial = validator.backup.take().expect("not finalized");
        assert!(CompletedBackup::try_from(partial).is_err());
    }

    #[test]
    fn validator_rejects_a_duplicate_account_frame() {
        let mut validator = OnlineBackupValidator_New(&backup_info(), PURPOSE_REMOTE_BACKUP).expect("valid info");
        let partial = validator.backup.as_mut().expect("not finalized");
        partial.parse_and_add_frame(&account_frame(), |_| ()).expect("valid account");
        assert!(partial.parse_and_add_frame(&account_frame(), |_| ()).is_err());
    }

    #[test]
    fn forward_secrecy_token_changes_the_message_backup_key() {
        let backup_key = BackupKey([3; BACKUP_KEY_LEN]);
        let backup_id = BackupId([4; 16]);
        let plain = message_backup_key(&backup_key, &backup_id, None, "test").expect("derived");
        let token = Some(vec![5; BACKUP_FORWARD_SECRECY_TOKEN_LEN]);
        let with_token = message_backup_key(&backup_key, &backup_id, token, "test").expect("derived");
        assert_ne!(plain.0.aes_key, with_token.0.aes_key);
        assert_ne!(plain.0.hmac_key, with_token.0.hmac_key);
        let again = message_backup_key(&backup_key, &backup_id, None, "test").expect("derived");
        assert_eq!(plain.0.aes_key, again.0.aes_key);
    }

    #[test]
    fn padding_covers_the_minimum_size() {
        let interval = MessageBackupSizing_FlushInterval(0, 0);
        assert!(interval > 0);
        assert!(MessageBackupSizing_FlushInterval(1 << 30, 0) >= interval);
        assert!(MessageBackupSizing_PaddingSize(interval, 10) > 0);
    }
}
