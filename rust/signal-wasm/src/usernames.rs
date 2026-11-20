//! Username hashing and username link decryption for looking up users by username
//! (upstream `rust/bridge/shared/src/usernames.rs`).

use ::usernames::{Username, decrypt_username};
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt, JsResult};

#[wasm_bindgen]
pub fn Username_Hash(username: String) -> JsResult<Vec<u8>> {
    Username::new(&username)
        .map(|username| username.hash().to_vec())
        .or_throw_generic("Username_Hash")
}

#[wasm_bindgen]
pub fn UsernameLink_DecryptUsername(entropy: &[u8], encrypted_username: &[u8]) -> JsResult<String> {
    let operation = "UsernameLink_DecryptUsername";
    let entropy = entropy
        .try_into()
        .map_err(|_| ::usernames::UsernameLinkError::InvalidEntropyDataLength)
        .or_throw_generic(operation)?;
    decrypt_username(entropy, encrypted_username).or_throw_generic(operation)
}
