//! SVR-B, the enclave service that gives message backups forward secrecy: the computations of libsignal-net
//! `rust/net/src/svrb.rs` (`create_new_backup_chain`, `store_backup`, `restore_backup`) and of
//! `rust/net/src/svrb/ppss_ops.rs` without the network, which `src/lib/signal/svr/svrb.ts` drives, and the
//! exports of `rust/bridge/shared/src/net/svrb.rs` that give the results.
//!
//! A backup file holds a random token that its keys derive from. The token is stored in the file, encrypted under a key
//! that only the enclave releases (`libsignal_svrb` is the secret sharing of that key), so a backup cannot be read once
//! the enclave has dropped the key, such as after a newer backup replaced it.

use attest::constants::{
    ENCLAVE_ID_SVRB_2026Q2_PROD, ENCLAVE_ID_SVRB_2026Q3_PROD, RAFT_CONFIG_SVRB_2026Q2_PROD,
    RAFT_CONFIG_SVRB_2026Q3_PROD,
};
use attest::svr2;
use js_sys::{Object, Reflect};
use libsignal_account_keys::{
    BACKUP_FORWARD_SECRECY_TOKEN_LEN, BACKUP_KEY_LEN, BackupForwardSecrecyEncryptionKey, BackupKey,
};
use libsignal_svrb::proto::Message as _;
use libsignal_svrb::proto::backup_metadata::metadata_pb::Pair;
use libsignal_svrb::proto::backup_metadata::next_backup_pb::{Backup, From_previous, Restore};
use libsignal_svrb::proto::backup_metadata::{MetadataPb, NextBackupPb};
use libsignal_svrb::{Backup4, Error as LogicError, Query4, Remove4, Restore1, Restore2, V4Status};
use rand::TryRngCore as _;
use signal_crypto::{Aes256Ctr32, CryptographicMac};
use subtle::ConstantTimeEq as _;
use wasm_bindgen::prelude::*;

use crate::attestation::{SgxClientState, new_client, system_time};
use crate::error::{JsResult, generic_error, make_error};

/// `PpssSetup for SvrBEnv`: one replica, whose server id is 1
const SERVER_IDS: [u64; 1] = [1];
/// libsignal-net `do_prepare`
const MAX_TRIES: u32 = 255;
/// libsignal-net `HMAC_SHA256_TRUNCATED_BYTES`
const MAC_LENGTH: usize = 16;
const IV_LENGTH: usize = Aes256Ctr32::NONCE_SIZE;
const SALT_LENGTH: usize = 32;
const MAX_PAIRS: usize = 2;

/// What `store_backup` gives, before the request that uploads the previous backup is sent
#[wasm_bindgen]
pub struct BackupStoreResponse {
    token: [u8; BACKUP_FORWARD_SECRECY_TOKEN_LEN],
    metadata: Vec<u8>,
    next_backup_data: Vec<u8>,
    finalize_request: Vec<u8>,
}

/// A started restore: its first request is out, and the enclave's answer finishes it
#[wasm_bindgen]
pub struct SvrBRestore1(Restore1<'static>);

#[wasm_bindgen]
pub struct SvrBRestore2(Restore2<'static>);

/// What `restore_backup` gives for the pair of the metadata that the enclave could open
#[wasm_bindgen]
pub struct BackupRestoreResponse {
    token: [u8; BACKUP_FORWARD_SECRECY_TOKEN_LEN],
    next_backup_data: Vec<u8>,
}

fn svrb_error(name: &str, message: &str, operation: &str, tries_remaining: Option<u32>) -> JsValue {
    let extra_props = tries_remaining.map(|tries| {
        let object = Object::new();
        // Setting a property on a fresh object cannot fail
        let _ = Reflect::set(&object, &"triesRemaining".into(), &tries.into());
        object
    });
    make_error(Some(name), message, operation, extra_props)
}

/// The names that `SvrError` in `src/lib/signal/svr/svrb.ts` reads
fn logic_error(error: LogicError, operation: &str) -> JsValue {
    let message = error.to_string();
    match error {
        LogicError::RestoreFailed(tries) => svrb_error("SvrBRestoreFailed", &message, operation, Some(tries)),
        LogicError::BadResponseStatus4(V4Status::MISSING) => svrb_error("SvrBDataMissing", &message, operation, None),
        LogicError::BadData => svrb_error("SvrBInvalidData", &message, operation, None),
        _ => svrb_error("SvrBProtocol", &message, operation, None),
    }
}

fn backup_key(bytes: &[u8], operation: &str) -> JsResult<BackupKey> {
    let bytes: [u8; BACKUP_KEY_LEN] =
        bytes.try_into().map_err(|_| generic_error("invalid backup key length", operation))?;
    Ok(BackupKey(bytes))
}

fn random_32b() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.try_fill_bytes(&mut bytes).expect("available entropy");
    bytes
}

/// The handshake with a SVR-B enclave: the raft group of the build that has the MRENCLAVE is the one that attestation
/// expects (libsignal-net `SvrBEnv`, `PROD`)
#[wasm_bindgen]
pub fn SvrBClient_New(mrenclave: &[u8], attestation_msg: &[u8], current_timestamp: f64) -> JsResult<SgxClientState> {
    let config = if mrenclave == ENCLAVE_ID_SVRB_2026Q3_PROD {
        RAFT_CONFIG_SVRB_2026Q3_PROD
    } else if mrenclave == ENCLAVE_ID_SVRB_2026Q2_PROD {
        RAFT_CONFIG_SVRB_2026Q2_PROD
    } else {
        return Err(generic_error("unknown SVR-B enclave", "SvrBClient_New"));
    };
    new_client(
        svr2::new_handshake(mrenclave, attestation_msg, system_time(current_timestamp), config),
        "SvrBClient_New",
    )
}

/// The password of a backup attempt and its salt: a new backup is prepared for the enclave, but not sent
fn create_backup(backup_key: &BackupKey) -> (Backup4, [u8; SALT_LENGTH]) {
    let password_salt = random_32b();
    let password_key = backup_key.derive_forward_secrecy_password(&password_salt).0;
    let backup4 = Backup4::new(
        &SERVER_IDS,
        &password_key,
        std::num::NonZeroU32::new(MAX_TRIES).expect("nonzero"),
        &mut rand::rngs::OsRng.unwrap_err(),
    );
    (backup4, password_salt)
}

fn new_backup_data(password_salt: [u8; SALT_LENGTH], backup4: Backup4) -> NextBackupPb {
    NextBackupPb {
        from_previous: Some(From_previous::Backup(Backup {
            pw_salt: password_salt.to_vec(),
            backup4: protobuf::MessageField::some(backup4.into_pb()),
            ..Default::default()
        })),
        ..Default::default()
    }
}

/// The data that starts the chain of backups, which the next `SecureValueRecoveryForBackups_PrepareStore` takes
#[wasm_bindgen]
pub fn SecureValueRecoveryForBackups_CreateNewBackupChain(backup_key_bytes: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "SecureValueRecoveryForBackups_CreateNewBackupChain";
    let (backup4, password_salt) = create_backup(&backup_key(backup_key_bytes, operation)?);
    new_backup_data(password_salt, backup4).write_to_bytes().map_err(|e| generic_error(e, operation))
}

/// Starts a backup: gives the token for the file, the metadata to write at its start, the data for the next backup and
/// the request that puts the previous backup's key into the enclave (`finalize_request`, empty when the previous data
/// came from a restore, which left the enclave as it is)
#[wasm_bindgen]
pub fn SecureValueRecoveryForBackups_PrepareStore(
    backup_key_bytes: &[u8],
    previous_secret_data: &[u8],
) -> JsResult<BackupStoreResponse> {
    let operation = "SecureValueRecoveryForBackups_PrepareStore";
    let invalid_data = || svrb_error("SvrBInvalidData", "invalid previous backup data", operation, None);
    let backup_key = backup_key(backup_key_bytes, operation)?;
    let previous = NextBackupPb::parse_from_bytes(previous_secret_data).map_err(|_| invalid_data())?;

    let (previous_encryption_salt, previous_backup4, previous_password_salt) =
        match previous.from_previous.ok_or_else(invalid_data)? {
            // The data came from a restore: what is in the enclave stays, and its pair stays in the metadata
            From_previous::Restore(restore) => (
                <[u8; 32]>::try_from(restore.enc_salt).map_err(|_| invalid_data())?,
                None,
                <[u8; SALT_LENGTH]>::try_from(restore.pw_salt).map_err(|_| invalid_data())?,
            ),
            // The data came from a backup that was prepared and never sent: it goes to the enclave now, and the file
            // that this call makes can still be opened through the pair of either backup
            From_previous::Backup(mut backup) => {
                let password_salt = <[u8; SALT_LENGTH]>::try_from(backup.pw_salt).map_err(|_| invalid_data())?;
                let backup4 =
                    Backup4::from_pb(backup.backup4.take().ok_or_else(invalid_data)?).map_err(|_| invalid_data())?;
                (backup4.output, Some(backup4), password_salt)
            }
            _ => return Err(invalid_data()),
        };

    let (next_backup4, next_password_salt) = create_backup(&backup_key);
    let token = random_32b();
    let mut iv = [0u8; IV_LENGTH];
    rand::rngs::OsRng.try_fill_bytes(&mut iv).expect("available entropy");

    let mut metadata = MetadataPb { iv: iv.to_vec(), ..Default::default() };
    for (encryption_salt, password_salt) in
        [(previous_encryption_salt, previous_password_salt), (next_backup4.output, next_password_salt)]
    {
        let encryption_key = backup_key.derive_forward_secrecy_encryption_key(&encryption_salt);
        metadata.pair.push(Pair {
            pw_salt: password_salt.to_vec(),
            ct: encrypt_token(&encryption_key, &iv, &token),
            ..Default::default()
        });
    }

    let finalize_request = previous_backup4.map(|backup4| backup4.requests[0].clone()).unwrap_or_default();
    Ok(BackupStoreResponse {
        token,
        metadata: metadata.write_to_bytes().map_err(|e| generic_error(e, operation))?,
        next_backup_data: new_backup_data(next_password_salt, next_backup4)
            .write_to_bytes()
            .map_err(|e| generic_error(e, operation))?,
        finalize_request,
    })
}

#[wasm_bindgen]
pub fn BackupStoreResponse_GetForwardSecrecyToken(response: &BackupStoreResponse) -> Vec<u8> {
    response.token.to_vec()
}

#[wasm_bindgen]
pub fn BackupStoreResponse_GetOpaqueMetadata(response: &BackupStoreResponse) -> Vec<u8> {
    response.metadata.clone()
}

#[wasm_bindgen]
pub fn BackupStoreResponse_GetNextBackupSecretData(response: &BackupStoreResponse) -> Vec<u8> {
    response.next_backup_data.clone()
}

#[wasm_bindgen]
pub fn BackupStoreResponse_GetFinalizeRequest(response: &BackupStoreResponse) -> Vec<u8> {
    response.finalize_request.clone()
}

/// The salts of the passwords of a backup file's metadata, 32 bytes each: every pair is a try at the key in the enclave
#[wasm_bindgen]
pub fn SecureValueRecoveryForBackups_GetMetadataSalts(metadata: &[u8]) -> JsResult<Vec<u8>> {
    let (_, pairs) = parse_metadata(metadata, "SecureValueRecoveryForBackups_GetMetadataSalts")?;
    Ok(pairs.into_iter().flat_map(|pair| pair.pw_salt).collect())
}

/// Starts the restore of a pair's key: the password derives from the backup key and the pair's salt
#[wasm_bindgen]
pub fn SvrBRestore1_New(backup_key_bytes: &[u8], password_salt: &[u8]) -> JsResult<SvrBRestore1> {
    let backup_key = backup_key(backup_key_bytes, "SvrBRestore1_New")?;
    let password_key = backup_key.derive_forward_secrecy_password(password_salt).0;
    Ok(SvrBRestore1(Restore1::new(&SERVER_IDS, &password_key, &mut rand::rngs::OsRng.unwrap_err())))
}

#[wasm_bindgen]
pub fn SvrBRestore1_GetRequest(restore: &SvrBRestore1) -> Vec<u8> {
    restore.0.requests[0].clone()
}

/// The second request: it proves that the client knows the password, and is bound to the connection's handshake
#[wasm_bindgen]
pub fn SvrBRestore1_Restore2(restore: SvrBRestore1, response: &[u8], handshake_hash: &[u8]) -> JsResult<SvrBRestore2> {
    restore
        .0
        .restore2(&[response.to_vec()], &[handshake_hash], &mut rand::rngs::OsRng.unwrap_err())
        .map(SvrBRestore2)
        .map_err(|e| logic_error(e, "SvrBRestore1_Restore2"))
}

#[wasm_bindgen]
pub fn SvrBRestore2_GetRequest(restore: &SvrBRestore2) -> Vec<u8> {
    restore.0.requests[0].clone()
}

/// The salt of the key that encrypts the token, which the enclave gave back
#[wasm_bindgen]
pub fn SvrBRestore2_Restore(restore: SvrBRestore2, response: &[u8]) -> JsResult<Vec<u8>> {
    restore
        .0
        .restore(&[response.to_vec()])
        .map(|secret| secret.to_vec())
        .map_err(|e| logic_error(e, "SvrBRestore2_Restore"))
}

/// Opens the token of the pair at `pair_index` with the salt that the enclave gave, and makes the data for the next
/// backup: it keeps the enclave's key, so the next file's metadata can name it
#[wasm_bindgen]
pub fn SecureValueRecoveryForBackups_FinishRestore(
    backup_key_bytes: &[u8],
    metadata: &[u8],
    pair_index: usize,
    encryption_salt: &[u8],
) -> JsResult<BackupRestoreResponse> {
    let operation = "SecureValueRecoveryForBackups_FinishRestore";
    let backup_key = backup_key(backup_key_bytes, operation)?;
    let (iv, pairs) = parse_metadata(metadata, operation)?;
    let pair = pairs.get(pair_index).ok_or_else(|| generic_error("no such pair", operation))?;
    let token = open_token(&backup_key, &iv, pair, encryption_salt)
        .map_err(|message| svrb_error("SvrBDecryption", message, operation, None))?;

    let next_backup_data = NextBackupPb {
        from_previous: Some(From_previous::Restore(Restore {
            pw_salt: pair.pw_salt.clone(),
            enc_salt: encryption_salt.to_vec(),
            ..Default::default()
        })),
        ..Default::default()
    };
    Ok(BackupRestoreResponse {
        token,
        next_backup_data: next_backup_data.write_to_bytes().map_err(|e| generic_error(e, operation))?,
    })
}

#[wasm_bindgen]
pub fn BackupRestoreResponse_GetForwardSecrecyToken(response: &BackupRestoreResponse) -> Vec<u8> {
    response.token.to_vec()
}

#[wasm_bindgen]
pub fn BackupRestoreResponse_GetNextBackupSecretData(response: &BackupRestoreResponse) -> Vec<u8> {
    response.next_backup_data.clone()
}

/// The request for the tries that are left, which changes nothing in the enclave (`Query4`)
#[wasm_bindgen]
pub fn SvrBQuery_GetRequest() -> Vec<u8> {
    Query4::requests().next().expect("an endless iterator")
}

#[wasm_bindgen]
pub fn SvrBQuery_Finalize(response: &[u8]) -> JsResult<u32> {
    Query4::finalize(&[response.to_vec()]).map_err(|e| logic_error(e, "SvrBQuery_Finalize"))
}

/// The request that deletes the backup key from the enclave (`Remove4`)
#[wasm_bindgen]
pub fn SvrBRemove_GetRequest() -> Vec<u8> {
    Remove4::requests().next().expect("an endless iterator")
}

/// The metadata of a backup file: its IV and the pairs of a password salt and an encrypted token, as libsignal checks
/// them before it reads a backup (`rust/message-backup/src/frame/forward_secrecy.rs`), and libsignal-net `restore_backup`
fn read_metadata(metadata: &[u8]) -> Result<([u8; IV_LENGTH], Vec<Pair>), &'static str> {
    let metadata = MetadataPb::parse_from_bytes(metadata).map_err(|_| "unable to parse")?;
    if metadata.pair.is_empty() {
        return Err("no pairs");
    }
    // Bogus data must not exhaust the tries of the enclave
    if metadata.pair.len() > MAX_PAIRS {
        return Err("too many pairs");
    }
    // The lengths that libsignal checks before it reads a backup, so that a pair never asks the enclave for a bad salt
    if metadata.pair.iter().any(|pair| pair.pw_salt.len() != SALT_LENGTH) {
        return Err("bad salt length");
    }
    if metadata.pair.iter().any(|pair| pair.ct.len() != BACKUP_FORWARD_SECRECY_TOKEN_LEN + MAC_LENGTH) {
        return Err("bad token length");
    }
    let iv = <[u8; IV_LENGTH]>::try_from(metadata.iv).map_err(|_| "iv failure")?;
    Ok((iv, metadata.pair))
}

fn parse_metadata(metadata: &[u8], operation: &str) -> JsResult<([u8; IV_LENGTH], Vec<Pair>)> {
    read_metadata(metadata).map_err(|message| svrb_error("SvrBInvalidData", message, operation, None))
}

/// The token of a pair, opened with the salt of the key that the enclave gave
fn open_token(
    backup_key: &BackupKey,
    iv: &[u8; IV_LENGTH],
    pair: &Pair,
    encryption_salt: &[u8],
) -> Result<[u8; BACKUP_FORWARD_SECRECY_TOKEN_LEN], &'static str> {
    let encryption_key = backup_key.derive_forward_secrecy_encryption_key(encryption_salt);
    decrypt_token(&encryption_key, iv, &pair.ct)?.try_into().map_err(|_| "token has a wrong size")
}

fn mac(encryption_key: &BackupForwardSecrecyEncryptionKey, iv: &[u8; IV_LENGTH], data: &[u8]) -> Vec<u8> {
    let mut mac = CryptographicMac::new("HmacSha256", &encryption_key.hmac_key).expect("a known algorithm");
    mac.update(iv);
    mac.update(data);
    mac.finalize()
}

/// libsignal-net `aes_256_ctr_encrypt_hmacsha256`: the ciphertext and the first 16 bytes of the MAC, without the IV
fn encrypt_token(encryption_key: &BackupForwardSecrecyEncryptionKey, iv: &[u8; IV_LENGTH], token: &[u8]) -> Vec<u8> {
    let mut aes = Aes256Ctr32::from_key(&encryption_key.cipher_key, iv, 0).expect("key size valid");
    let mut ciphertext = token.to_vec();
    aes.process(&mut ciphertext);
    let tag = mac(encryption_key, iv, &ciphertext);
    ciphertext.extend_from_slice(&tag[..MAC_LENGTH]);
    ciphertext
}

/// libsignal-net `aes_256_ctr_hmacsha256_decrypt`
fn decrypt_token(
    encryption_key: &BackupForwardSecrecyEncryptionKey,
    iv: &[u8; IV_LENGTH],
    ciphertext: &[u8],
) -> Result<Vec<u8>, &'static str> {
    let (ciphertext, their_tag) = ciphertext.split_last_chunk::<MAC_LENGTH>().ok_or("truncated ciphertext")?;
    let our_tag = mac(encryption_key, iv, ciphertext);
    if !bool::from(our_tag[..MAC_LENGTH].ct_eq(their_tag)) {
        return Err("MAC verification failed");
    }
    let mut aes = Aes256Ctr32::from_key(&encryption_key.cipher_key, iv, 0).expect("key size valid");
    let mut token = ciphertext.to_vec();
    aes.process(&mut token);
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BACKUP_KEY: [u8; BACKUP_KEY_LEN] = [7; BACKUP_KEY_LEN];

    #[test]
    fn token_round_trips_and_a_flipped_bit_fails() {
        let backup_key: BackupKey = BackupKey(BACKUP_KEY);
        let key = backup_key.derive_forward_secrecy_encryption_key(&[1; 32]);
        let iv = [3u8; IV_LENGTH];
        let mut ciphertext = encrypt_token(&key, &iv, b"plaintext");
        assert_eq!(decrypt_token(&key, &iv, &ciphertext), Ok(b"plaintext".to_vec()));
        ciphertext[0] ^= 1;
        assert_eq!(decrypt_token(&key, &iv, &ciphertext), Err("MAC verification failed"));
    }

    #[test]
    fn the_first_store_sends_the_chain_start_and_the_next_one_the_previous_backup() {
        let chain = SecureValueRecoveryForBackups_CreateNewBackupChain(&BACKUP_KEY).expect("chain");
        let first = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &chain).expect("first store");
        assert!(!first.finalize_request.is_empty());

        let second = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &first.next_backup_data).expect("second");
        assert!(!second.finalize_request.is_empty());
        assert_ne!(first.token, second.token);
        // The file names the previous and the next key, so that it opens before and after the enclave takes the next
        let (_, pairs) = read_metadata(&second.metadata).expect("metadata");
        assert_eq!(pairs.len(), 2);
    }

    #[test]
    fn a_restore_keeps_the_enclave_untouched_and_names_its_pair() {
        let chain = SecureValueRecoveryForBackups_CreateNewBackupChain(&BACKUP_KEY).expect("chain");
        let stored = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &chain).expect("store");
        let (_, pairs) = read_metadata(&stored.metadata).expect("metadata");
        assert_eq!(pairs.len(), 2);

        // The enclave holds the first backup, whose output is the salt of the first pair's key
        let first = NextBackupPb::parse_from_bytes(&chain).expect("chain data");
        let Some(From_previous::Backup(backup)) = first.from_previous else { panic!("not a backup") };
        let encryption_salt = Backup4::from_pb(backup.backup4.unwrap()).expect("backup4").output;

        let restored = SecureValueRecoveryForBackups_FinishRestore(&BACKUP_KEY, &stored.metadata, 0, &encryption_salt)
            .expect("restore");
        assert_eq!(restored.token, stored.token);

        let next = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &restored.next_backup_data).expect("next");
        assert!(next.finalize_request.is_empty(), "nothing to upload after a restore");
        assert_eq!(read_metadata(&next.metadata).expect("metadata").1.len(), 2);
    }

    #[test]
    fn a_wrong_salt_does_not_open_the_token() {
        let chain = SecureValueRecoveryForBackups_CreateNewBackupChain(&BACKUP_KEY).expect("chain");
        let stored = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &chain).expect("store");
        let (iv, pairs) = read_metadata(&stored.metadata).expect("metadata");
        let backup_key: BackupKey = BackupKey(BACKUP_KEY);
        assert!(open_token(&backup_key, &iv, &pairs[0], &[9; 32]).is_err());
    }

    #[test]
    fn metadata_limits_match_libsignal() {
        let pair = Pair { ct: vec![1; 48], pw_salt: vec![2; 32], ..Default::default() };
        let with = |pairs: usize, iv: usize| {
            MetadataPb { iv: vec![0; iv], pair: vec![pair.clone(); pairs], ..Default::default() }
                .write_to_bytes()
                .expect("encodes")
        };
        assert!(read_metadata(&with(2, 12)).is_ok());
        assert!(read_metadata(&with(0, 12)).is_err());
        assert!(read_metadata(&with(3, 12)).is_err());
        assert!(read_metadata(&with(1, 11)).is_err());
        let with_pair = |pair: Pair| {
            MetadataPb { iv: vec![0; 12], pair: vec![pair], ..Default::default() }.write_to_bytes().expect("encodes")
        };
        assert!(
            read_metadata(&with_pair(Pair { ct: vec![1; 48], pw_salt: vec![2; 31], ..Default::default() })).is_err()
        );
        assert!(
            read_metadata(&with_pair(Pair { ct: vec![1; 47], pw_salt: vec![2; 32], ..Default::default() })).is_err()
        );
        assert!(
            read_metadata(&with_pair(Pair { ct: vec![1; 48], pw_salt: vec![2; 32], ..Default::default() })).is_ok()
        );
    }

    #[test]
    fn known_vector_of_the_forward_secrecy_key_derivation() {
        // The token and keys of libsignal `rust/message-backup/src/key.rs` (`message_backup_key_known`)
        use libsignal_account_keys::{AccountEntropyPool, BackupForwardSecrecyToken};
        use libsignal_core::Aci;
        use libsignal_message_backup::key::MessageBackupKey;

        let pool: AccountEntropyPool =
            "dtjs858asj6tv0jzsqrsmj0ubp335pisj98e9ssnss8myoc08drhtcktyawvx45l".parse().expect("valid");
        let aci = Aci::from_uuid_bytes(const_str::hex!("659aa5f4a28dfcc11ea1b997537a3d95"));
        let token = BackupForwardSecrecyToken(const_str::hex!(
            "69207061737320746865206b6e69666520746f207468652061786f6c6f746c21"
        ));
        let key = BackupKey::derive_from_account_entropy_pool(&pool);
        let derived = MessageBackupKey::derive(&key, &key.derive_backup_id(&aci), Some(&token));
        assert_eq!(
            derived.hmac_key,
            const_str::hex!("20e6ab57b87e051f3e695e953cf8a261dd307e4f92ae2921673f1d397e07887b")
        );
        assert_eq!(
            derived.aes_key,
            const_str::hex!("602af6ecfc09d695a8d58da9f18225e967979c5e03543ca0224a03cca3d9735e")
        );
    }
}
