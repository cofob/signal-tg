//! Key transparency client.
//!
//! Ported from libsignal `rust/net/chat/src/api/keytrans.rs` and its `keytrans` submodules, which depend on
//! tokio and the native chat connection. The three requests go through the `LowLevelChatApi` trait, which
//! `transport.rs` implements with JS callbacks. The proof verification is the vendored `libsignal-keytrans`
//! crate. Differences from upstream:
//!
//! - The current time is an argument instead of `SystemTime::now`, which `wasm32-unknown-unknown` lacks. The
//!   caller passes `getServerTime`, which follows the `Date` header of the answers of the chat and storage servers
//!   and is the device clock until the first one arrives.
//! - Request failures are the exceptions of the JS callbacks, which `exports.rs` rethrows unchanged.
//! - No logging.

// The signatures of the upstream functions carry every identifier of the account
#![allow(clippy::too_many_arguments)]

mod exports;
mod maybe_partial;
mod monitor_and_search;
mod transport;
mod verify_ext;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::{self, Debug, Formatter};
use std::time::SystemTime;

use async_trait::async_trait;
use const_str::hex;
use libsignal_core::{Aci, E164};
use libsignal_keytrans::{
    AccountData, ChatDistinguishedResponse, ChatMonitorResponse, ChatSearchResponse,
    CondensedTreeSearchResponse, DeploymentMode, FullSearchResponse, FullTreeHead, KeyTransparency,
    LastTreeHead, LocalStateUpdate, MonitorContext, MonitorKey, MonitorProof, MonitorRequest,
    MonitorResponse, PublicConfig, SearchContext, SearchStateUpdate,
    SlimSearchRequest, StoredAccountData, VerifyingKey, VerifyingKeys, VrfPublicKey,
};
use libsignal_protocol::PublicKey;
pub(crate) use maybe_partial::{AccountDataField, MaybePartial};
pub(crate) use monitor_and_search::{TreeHeadWithTimestamp, check};
use verify_ext::KeyTransparencyVerifyExt as _;

const SEARCH_KEY_PREFIX_ACI: &[u8] = b"a";
const SEARCH_KEY_PREFIX_E164: &[u8] = b"n";
const SEARCH_KEY_PREFIX_USERNAME_HASH: &[u8] = b"u";

// Production key material of libsignal `rust/net/src/env.rs` (`KEYTRANS_CONFIG_PROD`)
const SIGNING_KEY_MATERIAL: [u8; 32] = hex!("a3973067984382cfa89ec26d7cc176680aefe92b3d2eba85159dad0b8354b622");
const VRF_KEY_MATERIAL: [u8; 32] = hex!("3849cf116c7bc9aef5f13f0c61a7c246e5bade4eb7e1c7b0efcacdd8c1e6a6ff");
const AUDITOR_KEY_MATERIAL: [[u8; 32]; 3] = [
    hex!("2d973608e909a09e12cbdbd21ad58775fd72fe1034a5a079f26541d5764ce17f"),
    hex!("2f217a86cd2dbc95d46a84420942a95877b3723f634bc64bb9e406796df746ef"),
    hex!("7fe5d91de235188486d8fb836a6da37e625e2b10eb6d144185b9364cc83cbbb6"),
];

/// Builds the verification configuration from the signing, VRF and auditor public keys
pub(crate) fn build_public_config(
    signing_key: &[u8; 32],
    vrf_key: &[u8; 32],
    auditor_keys: &[[u8; 32]],
) -> PublicConfig {
    let auditor_keys = auditor_keys
        .iter()
        .map(|bytes| VerifyingKey::from_bytes(bytes).expect("valid auditor key material"));
    PublicConfig {
        mode: DeploymentMode::ThirdPartyAuditing(VerifyingKeys::new(auditor_keys)),
        signature_key: VerifyingKey::from_bytes(signing_key).expect("valid signing key material"),
        vrf_key: VrfPublicKey::try_from(*vrf_key).expect("valid VRF key material"),
    }
}

/// The configuration of the production key transparency log
pub(crate) fn production_config() -> PublicConfig {
    build_public_config(&SIGNING_KEY_MATERIAL, &VRF_KEY_MATERIAL, &AUDITOR_KEY_MATERIAL)
}

#[derive(Eq, Debug, PartialEq, Clone, Copy)]
pub(crate) enum CheckMode {
    SelfCheck { is_e164_discoverable: bool },
    ContactCheck,
}

#[derive(Debug)]
#[cfg_attr(test, derive(Clone))]
pub(crate) enum Error {
    VerificationFailed(libsignal_keytrans::Error),
    InvalidResponse(String),
    InvalidRequest(&'static str),
}

impl From<libsignal_keytrans::Error> for Error {
    fn from(error: libsignal_keytrans::Error) -> Self {
        Self::VerificationFailed(error)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::VerificationFailed(error) => write!(f, "Verification failed: {error}"),
            Self::InvalidResponse(message) => write!(f, "Invalid response: {message}"),
            Self::InvalidRequest(message) => write!(f, "Invalid request: {message}"),
        }
    }
}

#[derive(Debug)]
#[cfg_attr(test, derive(Clone))]
pub(crate) enum RequestError<E> {
    /// A JS callback threw. `remember_callback_error` keeps the exception, which `exports.rs` rethrows.
    Callback(String),
    Other(E),
}

impl<E> From<E> for RequestError<E> {
    fn from(error: E) -> Self {
        Self::Other(error)
    }
}

#[async_trait(?Send)]
pub(crate) trait LowLevelChatApi {
    async fn search(
        &self,
        aci: &Aci,
        aci_identity_key: &PublicKey,
        e164: Option<&(E164, Vec<u8>)>,
        username_hash: Option<&UsernameHash<'_>>,
        stored_account_data: Option<&AccountData>,
        distinguished_tree_head: &LastTreeHead,
    ) -> Result<Vec<u8>, RequestError<Error>>; // Expected to be a SearchResponse proto

    async fn distinguished(
        &self,
        last_distinguished: Option<&LastTreeHead>,
    ) -> Result<Vec<u8>, RequestError<Error>>; // Expected to be a ChatDistinguishedResponse proto

    async fn monitor(
        &self,
        aci: &Aci,
        e164: Option<&E164>,
        username_hash: Option<&UsernameHash<'_>>,
        account_data: &AccountData,
        last_distinguished_tree_head: &LastTreeHead,
    ) -> Result<Vec<u8>, RequestError<Error>>; // Expected to be a ChatMonitorResponse proto
}

// Differs from [`ChatSearchResponse`] by establishing proper optionality of fields.
pub(crate) struct TypedSearchResponse {
    pub(crate) full_tree_head: FullTreeHead,
    pub(crate) aci_search_response: CondensedTreeSearchResponse,
    pub(crate) e164_search_response: Option<CondensedTreeSearchResponse>,
    pub(crate) username_hash_search_response: Option<CondensedTreeSearchResponse>,
}

impl TypedSearchResponse {
    pub(crate) fn from_untyped(response: ChatSearchResponse) -> Result<Self, Error> {
        let ChatSearchResponse {
            tree_head,
            aci,
            e164,
            username_hash,
        } = response;
        Ok(Self {
            full_tree_head: tree_head
                .ok_or(Error::InvalidResponse("missing tree head".to_string()))?,
            aci_search_response: aci.ok_or(Error::InvalidResponse(
                "missing ACI search response".to_string(),
            ))?,
            e164_search_response: e164,
            username_hash_search_response: username_hash,
        })
    }
}

// Same as ChatMonitorResponse, only with the right optionality of fields
#[derive(Clone, Debug)]
struct TypedMonitorResponse {
    tree_head: FullTreeHead,
    aci: MonitorProof,
    e164: Option<MonitorProof>,
    username_hash: Option<MonitorProof>,
    inclusion: Vec<Vec<u8>>,
}

impl TypedMonitorResponse {
    fn from_untyped(
        require_e164: bool,
        require_username_hash: bool,
        response: ChatMonitorResponse,
    ) -> Result<Self, Error> {
        if require_e164 != response.e164.is_some()
            || require_username_hash != response.username_hash.is_some()
        {
            return Err(Error::InvalidResponse(
                "request/response optionality mismatch".to_string(),
            ));
        }
        let ChatMonitorResponse {
            tree_head,
            aci,
            username_hash,
            e164,
            inclusion,
        } = response;
        Ok(Self {
            tree_head: tree_head.ok_or(Error::InvalidResponse("missing tree head".to_string()))?,
            aci: aci.ok_or(Error::InvalidResponse(
                "missing ACI monitor proof".to_string(),
            ))?,
            e164,
            username_hash,
            inclusion,
        })
    }
}

/// Representation of an object as "search key" aligned with conversion
/// performed by the chat server.
///
/// Search keys from the Key Transparency server perspective are just arrays of
/// bytes, therefore in order to distinguish them and avoid (highly unlikely)
/// clashes Chat server adds unique prefixes to keys representing ACIs, E.164's,
/// and username hashes.
pub(crate) trait SearchKey {
    fn as_search_key(&self) -> Vec<u8>;
}

impl<T: SearchKey> SearchKey for &T {
    fn as_search_key(&self) -> Vec<u8> {
        (*self).as_search_key()
    }
}

impl SearchKey for Aci {
    fn as_search_key(&self) -> Vec<u8> {
        [SEARCH_KEY_PREFIX_ACI, self.service_id_binary().as_slice()].concat()
    }
}

impl SearchKey for E164 {
    fn as_search_key(&self) -> Vec<u8> {
        [SEARCH_KEY_PREFIX_E164, self.to_string().as_bytes()].concat()
    }
}

/// Type-safe wrapper for a byte slice representing username hash.
#[derive(Clone)]
#[cfg_attr(test, derive(PartialEq, Eq))]
pub(crate) struct UsernameHash<'a>(Cow<'a, [u8]>);

impl AsRef<[u8]> for UsernameHash<'_> {
    fn as_ref(&self) -> &[u8] {
        self.0.as_ref()
    }
}

impl Debug for UsernameHash<'_> {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.debug_struct("UsernameHash")
            .field("hex", &hex::encode(self.0.as_ref()))
            .finish()
    }
}

impl From<Vec<u8>> for UsernameHash<'_> {
    fn from(vec: Vec<u8>) -> Self {
        Self(Cow::Owned(vec))
    }
}

impl SearchKey for UsernameHash<'_> {
    fn as_search_key(&self) -> Vec<u8> {
        [SEARCH_KEY_PREFIX_USERNAME_HASH, self.0.as_ref()].concat()
    }
}

pub(crate) struct KeyTransparencyClient<'a> {
    pub(crate) inner: KeyTransparency,
    pub(crate) chat: &'a dyn LowLevelChatApi,
    /// The time the proofs are verified against
    pub(crate) now: SystemTime,
}

pub(crate) trait UnauthenticatedChatApi {
    async fn search(
        &self,
        aci: &Aci,
        aci_identity_key: &PublicKey,
        e164: Option<(E164, Vec<u8>)>,
        username_hash: Option<UsernameHash<'_>>,
        stored_account_data: Option<AccountData>,
        distinguished_tree_head: &LastTreeHead,
    ) -> Result<MaybePartial<AccountData>, RequestError<Error>>;

    async fn distinguished(
        &self,
        last_distinguished: Option<LastTreeHead>,
    ) -> Result<SearchStateUpdate, RequestError<Error>>;

    async fn monitor(
        &self,
        aci: &Aci,
        e164: Option<E164>,
        username_hash: Option<UsernameHash<'_>>,
        account_data: AccountData,
        last_distinguished_tree_head: &LastTreeHead,
    ) -> Result<AccountData, RequestError<Error>>;
}

impl<'a> KeyTransparencyClient<'a> {
    pub(crate) fn new(chat: &'a dyn LowLevelChatApi, config: PublicConfig, now: SystemTime) -> Self {
        Self {
            inner: KeyTransparency { config },
            chat,
            now,
        }
    }
}

impl UnauthenticatedChatApi for KeyTransparencyClient<'_> {
    async fn search(
        &self,
        aci: &Aci,
        aci_identity_key: &PublicKey,
        e164: Option<(E164, Vec<u8>)>,
        username_hash: Option<UsernameHash<'_>>,
        stored_account_data: Option<AccountData>,
        distinguished_tree_head: &LastTreeHead,
    ) -> Result<MaybePartial<AccountData>, RequestError<Error>> {
        let chat_search_response = self
            .chat
            .search(
                aci,
                aci_identity_key,
                e164.as_ref(),
                username_hash.as_ref(),
                stored_account_data.as_ref(),
                distinguished_tree_head,
            )
            .await
            .and_then(|proto_bytes| {
                prost::Message::decode(&proto_bytes[..]).map_err(|_| {
                    RequestError::Other(Error::InvalidResponse(
                        "invalid search response protobuf encoding".to_string(),
                    ))
                })
            })
            .and_then(|r| TypedSearchResponse::from_untyped(r).map_err(RequestError::Other))?;

        let e164_search_key = e164.as_ref().map(|(x, _)| x.as_search_key());
        let username_hash_search_key = username_hash.as_ref().map(SearchKey::as_search_key);

        let mut account_data = self
            .inner
            .verify_chat_search_response(
                aci,
                aci_identity_key,
                e164.map(|(e164, _)| e164),
                username_hash,
                stored_account_data,
                chat_search_response,
                Some(distinguished_tree_head),
                self.now,
            )
            .map_err(RequestError::Other)?;

        // Preserve search keys in account data
        account_data.inner.aci.search_key = aci.as_search_key();
        if let Some(stored) = account_data.inner.e164.as_mut() {
            stored.search_key = e164_search_key.unwrap_or_default();
        }
        if let Some(stored) = account_data.inner.username_hash.as_mut() {
            stored.search_key = username_hash_search_key.unwrap_or_default();
        }
        Ok(account_data)
    }

    async fn distinguished(
        &self,
        last_distinguished: Option<LastTreeHead>,
    ) -> Result<SearchStateUpdate, RequestError<Error>> {
        let ChatDistinguishedResponse {
            tree_head,
            distinguished,
        } = self
            .chat
            .distinguished(last_distinguished.as_ref())
            .await
            .and_then(|proto_bytes| {
                prost::Message::decode(&proto_bytes[..]).map_err(|_| {
                    RequestError::Other(Error::InvalidResponse(
                        "invalid distinguished response protobuf encoding".to_string(),
                    ))
                })
            })?;

        let tree_head = tree_head.ok_or_else(|| {
            RequestError::Other(Error::InvalidResponse(
                "tree head must be present".to_string(),
            ))
        })?;
        let condensed_response = distinguished.ok_or_else(|| {
            RequestError::Other(Error::InvalidResponse(
                "search response must be present".to_string(),
            ))
        })?;
        let search_response = FullSearchResponse::new(condensed_response, &tree_head);

        let slim_search_request = SlimSearchRequest::new(b"distinguished".to_vec());

        let verified_result = self
            .inner
            .verify_search(
                slim_search_request,
                search_response,
                SearchContext {
                    last_tree_head: None,
                    last_distinguished_tree_head: last_distinguished.as_ref(),
                    data: None,
                },
                false,
                self.now,
            )
            .map_err(|e| RequestError::Other(e.into()))?;
        Ok(verified_result.state_update)
    }

    async fn monitor(
        &self,
        aci: &Aci,
        e164: Option<E164>,
        username_hash: Option<UsernameHash<'_>>,
        account_data: AccountData,
        last_distinguished_tree_head: &LastTreeHead,
    ) -> Result<AccountData, RequestError<Error>> {
        let chat_monitor_response = self
            .chat
            .monitor(
                aci,
                e164.as_ref(),
                username_hash.as_ref(),
                &account_data,
                last_distinguished_tree_head,
            )
            .await
            .and_then(|proto_bytes| {
                prost::Message::decode(&proto_bytes[..]).map_err(|_| {
                    RequestError::Other(Error::InvalidResponse(
                        "invalid monitor response protobuf encoding".to_string(),
                    ))
                })
            })
            .and_then(|r| {
                TypedMonitorResponse::from_untyped(e164.is_some(), username_hash.is_some(), r)
                    .map_err(RequestError::Other)
            })?;

        let AccountData {
            aci: aci_monitoring_data,
            e164: e164_monitoring_data,
            username_hash: username_hash_monitoring_data,
            last_tree_head,
        } = account_data;

        let mut monitor_keys = Vec::with_capacity(3);
        let mut proofs = Vec::with_capacity(3);
        let mut monitoring_data_map = HashMap::with_capacity(3);

        let aci_monitor_key = MonitorKey {
            search_key: aci.as_search_key(),
            entry_position: aci_monitoring_data.latest_log_position(),
            commitment_index: aci_monitoring_data.index.to_vec(),
        };
        monitor_keys.push(aci_monitor_key);
        proofs.push(chat_monitor_response.aci);
        monitoring_data_map.insert(aci.as_search_key(), aci_monitoring_data.clone());

        if let Some(e164) = e164 {
            let monitoring_data = e164_monitoring_data.ok_or(RequestError::Other(
                Error::InvalidRequest("missing E.164 monitoring data"),
            ))?;
            let key = MonitorKey {
                search_key: e164.as_search_key(),
                entry_position: monitoring_data.latest_log_position(),
                commitment_index: monitoring_data.index.to_vec(),
            };
            monitor_keys.push(key);

            // The proof must be present. Checked in TypedMonitorResponse::from_untyped
            proofs.push(
                chat_monitor_response
                    .e164
                    .expect("checked in TypedMonitorResponse::from_untyped"),
            );
            monitoring_data_map.insert(e164.as_search_key(), monitoring_data);
        }

        if let Some(username_hash) = username_hash.clone() {
            let monitoring_data = username_hash_monitoring_data.ok_or(RequestError::Other(
                Error::InvalidRequest("missing username hash monitoring data"),
            ))?;
            let key = MonitorKey {
                search_key: username_hash.as_search_key().to_vec(),
                entry_position: monitoring_data.latest_log_position(),
                commitment_index: monitoring_data.index.to_vec(),
            };
            monitor_keys.push(key);
            // The proof must be present. Checked in TypedMonitorResponse::from_untyped
            proofs.push(
                chat_monitor_response
                    .username_hash
                    .expect("checked in TypedMonitorResponse::from_untyped"),
            );
            monitoring_data_map.insert(username_hash.as_search_key(), monitoring_data);
        }

        // We are using a single monitor request/response pair for all the possible keys
        let monitor_request = MonitorRequest {
            keys: monitor_keys,
            // Consistency is only used to verify "distinguished" search key
            consistency: None,
        };

        let monitor_response = MonitorResponse {
            tree_head: Some(chat_monitor_response.tree_head.clone()),
            proofs,
            inclusion: chat_monitor_response.inclusion,
        };

        let monitor_context = MonitorContext {
            last_tree_head: Some(&last_tree_head),
            last_distinguished_tree_head,
            data: monitoring_data_map,
        };

        let verified = self
            .inner
            .verify_monitor(&monitor_request, &monitor_response, monitor_context, self.now)
            .map_err(|e| RequestError::Other(e.into()))?;

        let LocalStateUpdate {
            tree_head,
            tree_root,
            mut monitoring_data,
        } = verified;

        let mut take_data = move |search_key: &[u8], err_message: &'static str| {
            monitoring_data
                .remove(search_key)
                .map(|mut d| {
                    d.search_key = search_key.to_vec();
                    d
                })
                .ok_or_else(|| RequestError::Other(Error::InvalidResponse(err_message.to_string())))
        };

        Ok(AccountData {
            aci: take_data(&aci.as_search_key(), "ACI monitoring data is missing")?,
            e164: e164
                .map(|e164| take_data(&e164.as_search_key(), "E.164 monitoring data is missing"))
                .transpose()?,
            username_hash: username_hash
                .map(|username_hash| {
                    take_data(
                        &username_hash.as_search_key(),
                        "username hash monitoring data is missing",
                    )
                })
                .transpose()?,
            last_tree_head: LastTreeHead(tree_head, tree_root),
        })
    }
}

pub(crate) trait AccountDataFieldReset {
    fn reset(self, field: AccountDataField) -> Self;
}

impl AccountDataFieldReset for StoredAccountData {
    fn reset(mut self, field: AccountDataField) -> Self {
        match field {
            AccountDataField::E164 => self.e164 = None,
            AccountDataField::UsernameHash => self.username_hash = None,
        }
        self
    }
}
