//! Usernames: hashes, proofs and candidates for reserving one, and username links
//! (upstream `rust/bridge/shared/src/usernames.rs`).

use ::usernames::{
    NicknameLimits, Username, UsernameLinkError, create_for_username, decrypt_username,
};
use rand::TryRngCore as _;
use wasm_bindgen::prelude::*;

use crate::error::{JsResult, generic_error, username_error, username_link_error};

#[wasm_bindgen]
pub fn Username_Hash(username: String) -> JsResult<Vec<u8>> {
    Username::new(&username)
        .map(|username| username.hash().to_vec())
        .map_err(|error| username_error(error, "Username_Hash"))
}

#[wasm_bindgen]
pub fn Username_Proof(username: String, randomness: &[u8]) -> JsResult<Vec<u8>> {
    let operation = "Username_Proof";
    let randomness: &[u8; 32] = randomness
        .try_into()
        .map_err(|_| generic_error("randomness must be 32 bytes", operation))?;
    Username::new(&username)
        .and_then(|username| username.proof(randomness))
        .map_err(|error| username_error(error, operation))
}

#[wasm_bindgen]
pub fn Username_CandidatesFrom(
    nickname: String,
    min_len: u32,
    max_len: u32,
) -> JsResult<Vec<String>> {
    let mut rng = rand::rngs::OsRng.unwrap_err();
    let limits = NicknameLimits::new(min_len as usize, max_len as usize);
    Username::candidates_from(&mut rng, &nickname, limits)
        .map_err(|error| username_error(error, "Username_CandidatesFrom"))
}

#[wasm_bindgen]
pub fn Username_HashFromParts(
    nickname: String,
    discriminator: String,
    min_len: u32,
    max_len: u32,
) -> JsResult<Vec<u8>> {
    let limits = NicknameLimits::new(min_len as usize, max_len as usize);
    Username::from_parts(&nickname, &discriminator, limits)
        .map(|username| username.hash().to_vec())
        .map_err(|error| username_error(error, "Username_HashFromParts"))
}

/// Returns the 32 bytes of entropy followed by the encrypted username
#[wasm_bindgen]
pub fn UsernameLink_Create(username: String, entropy: Option<Vec<u8>>) -> JsResult<Vec<u8>> {
    let operation = "UsernameLink_Create";
    let mut rng = rand::rngs::OsRng.unwrap_err();
    let entropy = entropy
        .map(|buf| {
            <[u8; 32]>::try_from(buf.as_slice())
                .map_err(|_| UsernameLinkError::InvalidEntropyDataLength)
        })
        .transpose()
        .map_err(|error| username_link_error(error, operation))?;
    let (entropy, mut buffer) = create_for_username(&mut rng, username, entropy.as_ref())
        .map_err(|error| username_link_error(error, operation))?;
    buffer.splice(0..0, entropy);
    Ok(buffer)
}

#[wasm_bindgen]
pub fn UsernameLink_DecryptUsername(entropy: &[u8], encrypted_username: &[u8]) -> JsResult<String> {
    let operation = "UsernameLink_DecryptUsername";
    let entropy = entropy
        .try_into()
        .map_err(|_| username_link_error(UsernameLinkError::InvalidEntropyDataLength, operation))?;
    decrypt_username(entropy, encrypted_username)
        .map_err(|error| username_link_error(error, operation))
}
