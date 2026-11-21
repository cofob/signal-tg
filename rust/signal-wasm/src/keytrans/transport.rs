//! The key transparency requests of the chat server, carried by JS callbacks.
//!
//! Ported from libsignal `rust/net/chat/src/ws/keytrans.rs`: the request bodies and the `serializedResponse`
//! envelope are built here, and the JS object only sends the HTTP requests on the unauthenticated chat socket:
//!
//! - `search(body: Uint8Array)`: `POST /v1/key-transparency/search` with the JSON `body`
//! - `distinguished(lastTreeHeadSize: number | undefined)`: `GET /v1/key-transparency/distinguished?lastTreeHeadSize=`
//! - `monitor(body: Uint8Array)`: `POST /v1/key-transparency/monitor` with the JSON `body`
//!
//! Each callback resolves to the response body of a successful request, and throws on any other status.

use async_trait::async_trait;
use base64::prelude::{BASE64_STANDARD, BASE64_STANDARD_NO_PAD, BASE64_URL_SAFE_NO_PAD, Engine as _};
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use libsignal_core::{Aci, E164};
use libsignal_keytrans::{AccountData, LastTreeHead};
use libsignal_protocol::PublicKey;
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use super::{Error, LowLevelChatApi, RequestError, UsernameHash};
use crate::error::remember_callback_error;

/// String representation of a value to be sent in chat server JSON requests.
trait AsChatValue {
    fn as_chat_value(&self) -> String;
}

impl AsChatValue for Aci {
    fn as_chat_value(&self) -> String {
        self.service_id_string()
    }
}

impl AsChatValue for E164 {
    fn as_chat_value(&self) -> String {
        self.to_string()
    }
}

impl AsChatValue for UsernameHash<'_> {
    fn as_chat_value(&self) -> String {
        BASE64_URL_SAFE_NO_PAD.encode(self.as_ref())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawChatSearchRequest {
    aci: String,
    aci_identity_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    e164: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unidentified_access_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_tree_head_size: Option<u64>,
    distinguished_tree_head_size: u64,
}

impl RawChatSearchRequest {
    fn new(
        aci: &Aci,
        aci_identity_key: &PublicKey,
        e164: Option<&(E164, Vec<u8>)>,
        username_hash: Option<&UsernameHash>,
        last_tree_head_size: Option<u64>,
        distinguished_tree_head_size: u64,
    ) -> Self {
        Self {
            aci: aci.as_chat_value(),
            aci_identity_key: BASE64_STANDARD.encode(aci_identity_key.serialize()),
            e164: e164.as_ref().map(|x| x.0.as_chat_value()),
            username_hash: username_hash.as_ref().map(|x| x.as_chat_value()),
            unidentified_access_key: e164.as_ref().map(|x| BASE64_STANDARD.encode(&x.1)),
            last_tree_head_size,
            distinguished_tree_head_size,
        }
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct RawChatSerializedResponse {
    serialized_response: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValueMonitor {
    value: String,
    entry_position: u64,
    commitment_index: String,
}

impl ValueMonitor {
    fn new(value: String, entry_position: u64, commitment_index: &[u8]) -> Self {
        Self {
            value,
            entry_position,
            commitment_index: BASE64_STANDARD_NO_PAD.encode(commitment_index),
        }
    }

    fn for_aci(aci: &Aci, entry_position: u64, commitment_index: &[u8]) -> Self {
        Self::new(aci.as_chat_value(), entry_position, commitment_index)
    }

    fn for_e164(e164: E164, entry_position: u64, commitment_index: &[u8]) -> Self {
        Self::new(e164.as_chat_value(), entry_position, commitment_index)
    }

    fn for_username_hash(username_hash: &UsernameHash, entry_position: u64, commitment_index: &[u8]) -> Self {
        Self::new(username_hash.as_chat_value(), entry_position, commitment_index)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawChatMonitorRequest {
    aci: ValueMonitor,
    #[serde(skip_serializing_if = "Option::is_none")]
    e164: Option<ValueMonitor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username_hash: Option<ValueMonitor>,
    last_non_distinguished_tree_head_size: u64,
    last_distinguished_tree_head_size: u64,
}

impl RawChatMonitorRequest {
    fn new(
        aci: &Aci,
        e164: Option<E164>,
        username_hash: Option<&UsernameHash<'_>>,
        account_data: &AccountData,
        distinguished_tree_head_size: u64,
    ) -> Result<Self, Error> {
        let last_non_distinguished_tree_head_size = account_data.last_tree_head.0.tree_size;

        if e164.is_some() != account_data.e164.is_some()
            || username_hash.is_some() != account_data.username_hash.is_some()
        {
            return Err(Error::InvalidRequest(
                "account data does not match the monitor request",
            ));
        }
        let e164 = e164.zip(account_data.e164.as_ref());
        let username_hash = username_hash.zip(account_data.username_hash.as_ref());

        Ok(Self {
            aci: ValueMonitor::for_aci(
                aci,
                account_data.aci.latest_log_position(),
                &account_data.aci.index,
            ),
            e164: e164.map(|(e164, data)| ValueMonitor::for_e164(e164, data.latest_log_position(), &data.index)),
            username_hash: username_hash
                .map(|(hash, data)| ValueMonitor::for_username_hash(hash, data.latest_log_position(), &data.index)),
            last_non_distinguished_tree_head_size,
            last_distinguished_tree_head_size: distinguished_tree_head_size,
        })
    }
}

fn to_json<T: Serialize>(request: &T) -> Vec<u8> {
    serde_json::to_vec(request).expect("can convert to JSON")
}

pub(super) struct JsTransport(pub(super) JsValue);

impl JsTransport {
    async fn send(&self, method: &'static str, args: &[JsValue]) -> Result<Vec<u8>, RequestError<Error>> {
        let body = self.call(method, args).await.map_err(|error| callback_failure(method, error))?;
        let response: RawChatSerializedResponse = serde_json::from_slice(&Uint8Array::new(&body).to_vec())
            .map_err(|_| RequestError::Other(Error::InvalidResponse("invalid response JSON".to_string())))?;
        BASE64_STANDARD_NO_PAD
            .decode(&response.serialized_response)
            .map_err(|_| RequestError::Other(Error::InvalidResponse("invalid base64".to_string())))
    }

    async fn call(&self, method: &'static str, args: &[JsValue]) -> Result<JsValue, JsValue> {
        let function: Function = Reflect::get(&self.0, &method.into())?.dyn_into().map_err(|_| {
            let message = format!("transport method `{method}` is not a function");
            JsValue::from(js_sys::Error::new(&message))
        })?;
        let args: Array = args.iter().collect();
        let result = function.apply(&self.0, &args)?;
        JsFuture::from(Promise::resolve(&result)).await
    }
}

fn callback_failure(method: &'static str, error: JsValue) -> RequestError<Error> {
    let description = error
        .dyn_ref::<js_sys::Error>()
        .map(|error| String::from(error.message()))
        .unwrap_or_else(|| method.to_owned());
    remember_callback_error(error);
    RequestError::Callback(description)
}

fn tree_size(head: &LastTreeHead) -> f64 {
    head.0.tree_size as f64
}

#[async_trait(?Send)]
impl LowLevelChatApi for JsTransport {
    async fn search(
        &self,
        aci: &Aci,
        aci_identity_key: &PublicKey,
        e164: Option<&(E164, Vec<u8>)>,
        username_hash: Option<&UsernameHash<'_>>,
        stored_account_data: Option<&AccountData>,
        distinguished_tree_head: &LastTreeHead,
    ) -> Result<Vec<u8>, RequestError<Error>> {
        let request = RawChatSearchRequest::new(
            aci,
            aci_identity_key,
            e164,
            username_hash,
            stored_account_data.map(|data| data.last_tree_head.0.tree_size),
            distinguished_tree_head.0.tree_size,
        );
        self.send("search", &[Uint8Array::from(to_json(&request).as_slice()).into()])
            .await
    }

    async fn distinguished(&self, last_distinguished: Option<&LastTreeHead>) -> Result<Vec<u8>, RequestError<Error>> {
        let size = last_distinguished.map_or(JsValue::UNDEFINED, |head| tree_size(head).into());
        self.send("distinguished", &[size]).await
    }

    async fn monitor(
        &self,
        aci: &Aci,
        e164: Option<&E164>,
        username_hash: Option<&UsernameHash<'_>>,
        account_data: &AccountData,
        last_distinguished_tree_head: &LastTreeHead,
    ) -> Result<Vec<u8>, RequestError<Error>> {
        let request = RawChatMonitorRequest::new(
            aci,
            e164.copied(),
            username_hash,
            account_data,
            last_distinguished_tree_head.0.tree_size,
        )?;
        self.send("monitor", &[Uint8Array::from(to_json(&request).as_slice()).into()])
            .await
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::keytrans::test_support::{test_account, test_account_data};

    #[test]
    fn search_request_json() {
        let request = RawChatSearchRequest::new(
            &test_account::aci(),
            &test_account::aci_identity_key(),
            Some(&test_account::e164_pair()),
            Some(&test_account::username_hash()),
            Some(681),
            677,
        );
        let value: serde_json::Value = serde_json::from_slice(&to_json(&request)).expect("valid JSON");
        assert_eq!(
            value,
            json!({
                "aci": "90c979fd-eab4-4a08-b6da-69dedeab9b29",
                "aciIdentityKey": "Bc3LsXgGfw3f0li7IdAG4KqcerEy2fteiwJ94H2Uf50M",
                "e164": "+18005550100",
                "usernameHash": "3HEYCMLPZtXmozzkHyfWnZQtLh_02yLTm0LS7_jQl0Y",
                "unidentifiedAccessKey": "EI2EtxvjB73xAeOAodfyog==",
                "lastTreeHeadSize": 681,
                "distinguishedTreeHeadSize": 677,
            })
        );
    }

    #[test]
    fn search_request_omits_absent_fields() {
        let request = RawChatSearchRequest::new(
            &test_account::aci(),
            &test_account::aci_identity_key(),
            None,
            None,
            None,
            677,
        );
        let value: serde_json::Value = serde_json::from_slice(&to_json(&request)).expect("valid JSON");
        let object = value.as_object().expect("an object");
        let mut keys: Vec<_> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["aci", "aciIdentityKey", "distinguishedTreeHeadSize"]);
    }

    #[test]
    fn monitor_request_json() {
        let account_data = test_account_data();
        let request = RawChatMonitorRequest::new(
            &test_account::aci(),
            Some(test_account::PHONE_NUMBER),
            Some(&test_account::username_hash()),
            &account_data,
            677,
        )
        .expect("matching account data");
        let value: serde_json::Value = serde_json::from_slice(&to_json(&request)).expect("valid JSON");
        let aci = &value["aci"];
        assert_eq!(aci["value"], "90c979fd-eab4-4a08-b6da-69dedeab9b29");
        assert_eq!(aci["entryPosition"], account_data.aci.latest_log_position());
        assert_eq!(aci["commitmentIndex"], BASE64_STANDARD_NO_PAD.encode(account_data.aci.index));
        assert_eq!(value["e164"]["value"], "+18005550100");
        assert_eq!(value["usernameHash"]["value"], "3HEYCMLPZtXmozzkHyfWnZQtLh_02yLTm0LS7_jQl0Y");
        assert_eq!(
            value["lastNonDistinguishedTreeHeadSize"],
            account_data.last_tree_head.0.tree_size
        );
        assert_eq!(value["lastDistinguishedTreeHeadSize"], 677);
    }

    #[test]
    fn monitor_request_rejects_mismatching_account_data() {
        let account_data = test_account_data();
        for (e164, username_hash) in [(None, Some(test_account::username_hash())), (Some(test_account::PHONE_NUMBER), None)] {
            let result = RawChatMonitorRequest::new(
                &test_account::aci(),
                e164,
                username_hash.as_ref(),
                &account_data,
                677,
            );
            assert!(matches!(result, Err(Error::InvalidRequest(_))));
        }
    }
}
