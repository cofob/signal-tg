//! `KeyTransparency_*` exports, after libsignal `rust/bridge/shared/src/net/keytrans.rs`.
//!
//! `KeyTransparency_Check` has the arguments of `Native.KeyTransparency_Check` except that the transport object
//! of `transport.rs` replaces the environment and the chat connection (the keys are the production ones), and
//! that the time to verify against is passed last. It resolves to `[accountData, distinguishedTreeHead]`, the
//! serialized records to store. `distinguishedTreeHead` is empty when the stored one stays as it is.

use std::time::{Duration, SystemTime};

use js_sys::{Array, Promise, Uint8Array};
use libsignal_core::{Aci, E164};
use libsignal_keytrans::{AccountData, StoredAccountData};
use prost::Message as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::transport::JsTransport;
use super::{
    AccountDataField, AccountDataFieldReset as _, CheckMode, Error, KeyTransparencyClient, MaybePartial, RequestError,
    SearchKey as _, TreeHeadWithTimestamp, UsernameHash, check, production_config,
};
use crate::error::{JsResult, make_error, take_callback_error};
use crate::handles::PublicKey;

const CHECK_OPERATION: &str = "KeyTransparency_Check";
const RESET_OPERATION: &str = "KeyTransparency_ResetDataField";

#[wasm_bindgen]
pub fn KeyTransparency_ResetDataField(account_data: &[u8], field: u8) -> JsResult<Vec<u8>> {
    let field = AccountDataField::try_from(field)
        .map_err(|field| make_error(None, &format!("unknown account data field {field}"), RESET_OPERATION, None))?;
    // The only failure is a decoding error, which returns an empty record as upstream does
    Ok(StoredAccountData::decode(account_data)
        .map(|stored| stored.reset(field).encode_to_vec())
        .unwrap_or_default())
}

#[wasm_bindgen]
pub fn KeyTransparency_Check(
    transport: JsValue,
    aci: &[u8],
    aci_identity_key: &PublicKey,
    e164: Option<String>,
    unidentified_access_key: Option<Vec<u8>>,
    username_hash: Option<Vec<u8>>,
    account_data: Option<Vec<u8>>,
    last_distinguished_tree_head: Option<Vec<u8>>,
    is_self_check: bool,
    is_e164_discoverable: bool,
    now: f64,
) -> Promise {
    let aci = <&[u8; 17]>::try_from(aci)
        .ok()
        .and_then(Aci::parse_from_service_id_fixed_width_binary)
        .ok_or("invalid ACI");
    let aci_identity_key = aci_identity_key.0;
    future_to_promise(async move {
        let aci = aci.map_err(|message| make_error(None, message, CHECK_OPERATION, None))?;
        let now = SystemTime::UNIX_EPOCH + Duration::from_millis(now as u64);
        let mode = if is_self_check {
            CheckMode::SelfCheck { is_e164_discoverable }
        } else {
            CheckMode::ContactCheck
        };

        let e164 = e164
            .map(|e164| {
                e164.parse::<E164>()
                    .map_err(|_| RequestError::Other(Error::InvalidRequest("invalid E.164")))
            })
            .transpose()
            .map_err(|error| keytrans_error(error, CHECK_OPERATION))?;
        let username_hash = username_hash.map(UsernameHash::from);
        let maybe_hash_search_key = username_hash.as_ref().map(|hash| hash.as_search_key());
        let account_data = account_data
            .map(|bytes| decode_account_data(&bytes))
            .transpose()
            .map_err(|error| keytrans_error(error, CHECK_OPERATION))?;
        let e164_pair = make_e164_pair(e164, unidentified_access_key)
            .map_err(|error| keytrans_error(error, CHECK_OPERATION))?;
        let last_distinguished_tree_head = last_distinguished_tree_head.and_then(decode_distinguished);
        let previously_stored_distinguished = last_distinguished_tree_head.clone();

        let transport = JsTransport(transport);
        let kt = KeyTransparencyClient::new(&transport, production_config(), now);
        let (maybe_partial_result, updated_distinguished) = check(
            &kt,
            &aci,
            &aci_identity_key,
            e164_pair,
            username_hash,
            account_data,
            last_distinguished_tree_head,
            mode,
            now,
        )
        .await
        .map_err(|error| keytrans_error(error, CHECK_OPERATION))?;

        let serialized_account_data = into_serialized_account_data(
            maybe_partial_result,
            aci.as_search_key(),
            e164.map(|e164| e164.as_search_key()),
            maybe_hash_search_key,
            now,
        )
        .map_err(|error| keytrans_error(error, CHECK_OPERATION))?;
        let distinguished_to_be_stored = if let Some(known) = previously_stored_distinguished
            && known.tree_head == updated_distinguished
        {
            // Distinguished has not been updated, we must keep its stored_at
            vec![]
        } else {
            updated_distinguished.into_stored(now).encode_to_vec()
        };

        let result = Array::new();
        result.push(&Uint8Array::from(serialized_account_data.as_slice()));
        result.push(&Uint8Array::from(distinguished_to_be_stored.as_slice()));
        Ok(result.into())
    })
}

/// Names as in upstream `rust/bridge/shared/types/src/node/error.rs`
fn keytrans_error(error: RequestError<Error>, operation: &str) -> JsValue {
    match error {
        RequestError::Callback(description) => {
            take_callback_error().unwrap_or_else(|| make_error(None, &description, operation, None))
        }
        RequestError::Other(error) => {
            let name = match error {
                Error::VerificationFailed(libsignal_keytrans::Error::VerificationFailed(_)) => {
                    "KeyTransparencyVerificationFailed"
                }
                _ => "KeyTransparencyError",
            };
            make_error(Some(name), &error.to_string(), operation, None)
        }
    }
}

fn invalid_request(message: &'static str) -> RequestError<Error> {
    RequestError::Other(Error::InvalidRequest(message))
}

fn make_e164_pair(
    e164: Option<E164>,
    unidentified_access_key: Option<Vec<u8>>,
) -> Result<Option<(E164, Vec<u8>)>, RequestError<Error>> {
    match (e164, unidentified_access_key) {
        (None, None) => Ok(None),
        (Some(e164), Some(uak)) => Ok(Some((e164, uak))),
        (None, Some(_uak)) => Err(invalid_request("Unidentified access key without an E164")),
        (Some(_e164), None) => Err(invalid_request("E164 without unidentified access key")),
    }
}

fn decode_account_data(bytes: &[u8]) -> Result<AccountData, RequestError<Error>> {
    let stored =
        StoredAccountData::decode(bytes).map_err(|_| invalid_request("could not decode account data"))?;
    AccountData::try_from(stored).map_err(|err| RequestError::Other(Error::from(err)))
}

fn decode_distinguished(bytes: Vec<u8>) -> Option<TreeHeadWithTimestamp> {
    libsignal_keytrans::StoredTreeHead::decode(bytes.as_slice())
        .ok()
        .and_then(TreeHeadWithTimestamp::from_stored)
}

fn into_serialized_account_data(
    result: MaybePartial<AccountData>,
    aci_search_key: Vec<u8>,
    maybe_e164_search_key: Option<Vec<u8>>,
    maybe_hash_search_key: Option<Vec<u8>>,
    stored_at: SystemTime,
) -> Result<Vec<u8>, RequestError<Error>> {
    result
        .map(|data| {
            data.into_stored(aci_search_key, maybe_e164_search_key, maybe_hash_search_key, stored_at)
                .encode_to_vec()
        })
        .into_result()
        .map_err(|missing| {
            RequestError::Other(Error::InvalidResponse(format!(
                "Some fields are missing from the response: {}",
                missing.iter().map(ToString::to_string).collect::<Vec<_>>().join(", ")
            )))
        })
}
