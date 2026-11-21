//! Account entropy pool and the keys derived from it, for registering a primary device
//! (upstream `rust/bridge/shared/src/account_keys.rs`).

use libsignal_account_keys::{AccountEntropyPool, BackupKey, SVR_KEY_LEN, SvrKey};
use rand::TryRngCore as _;
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt, JsResult};

#[wasm_bindgen]
pub fn AccountEntropyPool_Generate() -> String {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    AccountEntropyPool::generate(&mut rng).to_string()
}

#[wasm_bindgen]
pub fn AccountEntropyPool_DeriveSvrKey(account_entropy: String) -> JsResult<Vec<u8>> {
    account_entropy
        .parse::<AccountEntropyPool>()
        .map(|pool| pool.derive_svr_key().to_vec())
        .or_throw_generic("AccountEntropyPool_DeriveSvrKey")
}

#[wasm_bindgen]
pub fn SvrKey_DeriveRegistrationRecoveryPassword(svr_key: &[u8]) -> JsResult<Vec<u8>> {
    <[u8; SVR_KEY_LEN]>::try_from(svr_key)
        .map(|key| {
            SvrKey::new(key)
                .derive_registration_recovery_password()
                .to_vec()
        })
        .or_throw_generic("SvrKey_DeriveRegistrationRecoveryPassword")
}

#[wasm_bindgen]
pub fn SvrKey_DeriveRegistrationLock(svr_key: &[u8]) -> JsResult<Vec<u8>> {
    <[u8; SVR_KEY_LEN]>::try_from(svr_key)
        .map(|key| SvrKey::new(key).derive_registration_lock().to_vec())
        .or_throw_generic("SvrKey_DeriveRegistrationLock")
}

#[wasm_bindgen]
pub fn AccountEntropyPool_DeriveBackupKey(account_entropy: String) -> JsResult<Vec<u8>> {
    account_entropy
        .parse::<AccountEntropyPool>()
        .map(|pool| BackupKey::derive_from_account_entropy_pool(&pool).0.to_vec())
        .or_throw_generic("AccountEntropyPool_DeriveBackupKey")
}

#[wasm_bindgen]
pub fn AccountEntropyPool_IsValid(account_entropy: String) -> bool {
    account_entropy.parse::<AccountEntropyPool>().is_ok()
}
