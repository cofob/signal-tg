//! Fixtures of libsignal `rust/net/chat/src/api/keytrans.rs` (`test_support`) for the staging log.

use std::cell::Cell;
use std::num::NonZeroU64;
use std::time::Duration;

use const_str::hex;
use libsignal_core::{Aci, E164};
use libsignal_keytrans::{
    AccountData, LastTreeHead, PublicConfig, SearchStateUpdate, StoredAccountData, TreeHead,
};
use libsignal_protocol::PublicKey;
use prost::Message as _;

use super::{
    Error, MaybePartial, RequestError, UnauthenticatedChatApi, UsernameHash, build_public_config,
};

const SIGNING_KEY_MATERIAL_STAGING: [u8; 32] =
    hex!("ac0de1fd7f33552bbeb6ebc12b9d4ea10bf5f025c45073d3fb5f5648955a749e");
const VRF_KEY_MATERIAL_STAGING: [u8; 32] =
    hex!("ec3a268237cf5c47115cf222405d5f90cc633ebe05caf82c0dd5acf9d341dadb");
const AUDITOR_KEY_MATERIAL_STAGING: [[u8; 32]; 3] = [
    hex!("1123b13ee32479ae6af5739e5d687b51559abf7684120511f68cde7a21a0e755"),
    hex!("bd1e26a0fbdbfa923486ccc9296f4227db490b4add29f5507775171ea0fb7a4e"),
    hex!("093ee42d95502b3e81f4e604179c82c149fffb96167642b9eb81b03d6e2dd636"),
];

pub(super) fn staging_config() -> PublicConfig {
    build_public_config(
        &SIGNING_KEY_MATERIAL_STAGING,
        &VRF_KEY_MATERIAL_STAGING,
        &AUDITOR_KEY_MATERIAL_STAGING,
    )
}

pub(super) mod test_account {
    use std::borrow::Cow;

    use const_str::hex;

    use super::*;

    pub const ACI: uuid::Uuid = uuid::uuid!("90c979fd-eab4-4a08-b6da-69dedeab9b29");
    pub const ACI_IDENTITY_KEY_BYTES: &[u8] =
        &hex!("05cdcbb178067f0ddfd258bb21d006e0aa9c7ab132d9fb5e8b027de07d947f9d0c");
    pub const USERNAME_HASH: &[u8] =
        &hex!("dc711808c2cf66d5e6a33ce41f27d69d942d2e1ff4db22d39b42d2eff8d09746");
    pub const PHONE_NUMBER: E164 = E164::new(NonZeroU64::new(18005550100).unwrap());
    pub const UNIDENTIFIED_ACCESS_KEY: &[u8] = &hex!("108d84b71be307bdf101e380a1d7f2a2");

    pub fn aci() -> Aci {
        Aci::from(ACI)
    }

    pub fn aci_identity_key() -> PublicKey {
        PublicKey::deserialize(ACI_IDENTITY_KEY_BYTES).expect("valid key bytes")
    }

    pub fn username_hash() -> UsernameHash<'static> {
        UsernameHash(Cow::Borrowed(USERNAME_HASH))
    }

    // To be used for search function
    pub fn e164_pair() -> (E164, Vec<u8>) {
        (PHONE_NUMBER, UNIDENTIFIED_ACCESS_KEY.to_vec())
    }
}

pub(super) const CHAT_SEARCH_RESPONSE: &[u8] =
    include_bytes!("../../../libsignal/rust/keytrans/res/chat_search_response.dat");
pub(super) const CHAT_SEARCH_RESPONSE_VALID_AT: Duration = Duration::from_secs(1775843959);

const DISTINGUISHED_TREE_677_HEAD: &[u8] = &hex!(
    "08a50510f981afc4d7331a640a20bd1e26a0fbdbfa923486ccc9296f4227db490b4add29f5507775171ea0fb7a4e1240404fcd202d174fa3c1db70dd7a2af28aa7289230f16bbbabfbb0cf8ac0351ce8ddcc770a4e5ab2a2b32b4af7fba5e056f2d6f70be1039c152aeda2e7c6117a0d1a640a201123b13ee32479ae6af5739e5d687b51559abf7684120511f68cde7a21a0e7551240521e691c9356343feee2e80c5355d1f257550d870542ac0b6e25d349b6223966eb0859dd0df942cd5e541b37e9028682c9c986a5c9f33ce4739e205f58cbd2061a640a20093ee42d95502b3e81f4e604179c82c149fffb96167642b9eb81b03d6e2dd636124081185aaf680e96e329dee42cdb2f1ce7bef6da769b51dabfda8db0163977d500a47d00fe60a6fe3e2562f08e5ff8c4ec4dfcf054e31a85b28d0665ff92c0f901"
);
const DISTINGUISHED_TREE_677_ROOT: &[u8] =
    &hex!("8bf5f1bdfb17a7772210f05192e4581f4b4364c9ca2efdd79244d5fc01adcde5");

const STORED_ACCOUNT_DATA_681: &[u8] = &hex!(
    "0a3e0a203901c94081c4e6321e92b3e434dcaf788f5326913e7bdcab47b4fd2ae7a6848a10131a0308ff0320012a116190c979fdeab44a08b6da69dedeab9b29123a0a2086052cc2a2689558e852d053c5ab411d8c3baef20171ec298e551574806ca95d104c1a0308ff0320012a0d6e2b31383030353535303130301a4f0a206f55ac745ebeaf39fd5b21177c7fa692876c42678ffa1f3d58ed8fbc5ef023b910a6011a0308ff0320012a2175dc711808c2cf66d5e6a33ce41f27d69d942d2e1ff4db22d39b42d2eff8d0974622e8020abc0208a90510bec5b0c4d7331a640a20bd1e26a0fbdbfa923486ccc9296f4227db490b4add29f5507775171ea0fb7a4e124000eec714425c086bcde66e5a2af2c87031eea6c485965b549ac81bc3793cf5bdd5222073f59dd4959f6e9fdb6f6d405a477a7aaeb4bc8fd89b876b59cf89bf031a640a201123b13ee32479ae6af5739e5d687b51559abf7684120511f68cde7a21a0e755124034a1a53ac786258ad28d79b3b9cd9a59219b1449b10e769f3934d8981bf58d47c594439a93a3bb1adc318b5b227a60257406052f4501540d06c3d01b07a35a051a640a20093ee42d95502b3e81f4e604179c82c149fffb96167642b9eb81b03d6e2dd63612402cec2570d4fc3e3063aa9c358e2fcb55ae65f25f8c82072fc8d4016ce4fe2be182adeee08d786745109a8978189791feb52d2ebe7e98d1a22ab0478ea5190e0b1220032487becda242fa353ee8654ba3a5fb7d9e9aa1d48eb42f2ea6866070a494a118c4d6b0c4d733"
);

pub(super) fn test_distinguished_tree() -> LastTreeHead {
    LastTreeHead(
        TreeHead::decode(DISTINGUISHED_TREE_677_HEAD).expect("valid TreeHead"),
        DISTINGUISHED_TREE_677_ROOT
            .try_into()
            .expect("valid root size"),
    )
}

pub(super) fn test_stored_account_data() -> StoredAccountData {
    StoredAccountData::decode(STORED_ACCOUNT_DATA_681).expect("valid stored acc data")
}

pub(super) fn test_account_data() -> AccountData {
    AccountData::try_from(test_stored_account_data()).expect("valid account data")
}

#[derive(Debug, Clone)]
pub(super) struct OwnedParameters {
    pub aci: Aci,
    pub e164: Option<(E164, Vec<u8>)>,
    pub username_hash_bytes: Option<Vec<u8>>,
}

pub(super) struct TestKt {
    pub monitor: Cell<Option<Result<AccountData, RequestError<Error>>>>,
    pub search: Cell<Option<Result<MaybePartial<AccountData>, RequestError<Error>>>>,
    pub distinguished: Cell<Option<Result<LastTreeHead, RequestError<Error>>>>,
    search_invocation: Cell<Option<OwnedParameters>>,
}

impl TestKt {
    pub fn for_monitor(monitor: Result<AccountData, RequestError<Error>>) -> Self {
        Self::new(Some(monitor), None)
    }

    pub fn for_search(search: Result<MaybePartial<AccountData>, RequestError<Error>>) -> Self {
        Self::new(None, Some(search))
    }

    #[must_use]
    pub fn with_distinguished(self, result: Result<LastTreeHead, RequestError<Error>>) -> Self {
        self.distinguished.set(Some(result));
        self
    }

    pub fn new(
        monitor: Option<Result<AccountData, RequestError<Error>>>,
        search: Option<Result<MaybePartial<AccountData>, RequestError<Error>>>,
    ) -> Self {
        Self {
            monitor: Cell::new(monitor),
            search: Cell::new(search),
            distinguished: Cell::new(Some(Ok(test_distinguished_tree()))),
            search_invocation: Cell::new(None),
        }
    }

    pub fn expected_error() -> RequestError<Error> {
        RequestError::Callback("test error".to_string())
    }

    pub fn assert_expected_error<T: std::fmt::Debug>(result: Result<T, RequestError<Error>>) {
        assert!(
            matches!(&result, Err(RequestError::Callback(message)) if message == "test error"),
            "{result:?}"
        );
    }

    pub fn search_invocation(self) -> Option<OwnedParameters> {
        self.search_invocation.into_inner()
    }
}

impl UnauthenticatedChatApi for TestKt {
    async fn search(
        &self,
        aci: &Aci,
        _aci_identity_key: &PublicKey,
        e164: Option<(E164, Vec<u8>)>,
        username_hash: Option<UsernameHash<'_>>,
        _stored_account_data: Option<AccountData>,
        _distinguished_tree_head: &LastTreeHead,
    ) -> Result<MaybePartial<AccountData>, RequestError<Error>> {
        self.search_invocation.set(Some(OwnedParameters {
            aci: *aci,
            e164,
            username_hash_bytes: username_hash.map(|x| x.as_ref().to_vec()),
        }));

        self.search.take().expect("unexpected call to search")
    }

    async fn distinguished(
        &self,
        _: Option<LastTreeHead>,
    ) -> Result<SearchStateUpdate, RequestError<Error>> {
        let tree_head = self
            .distinguished
            .take()
            .expect("unexpected call to distinguished");
        tree_head.map(|tree_head| SearchStateUpdate {
            tree_head: tree_head.0,
            tree_root: tree_head.1,
            monitoring_data: None,
        })
    }

    async fn monitor(
        &self,
        _aci: &Aci,
        _e164: Option<E164>,
        _username_hash: Option<UsernameHash<'_>>,
        _account_data: AccountData,
        _last_distinguished_tree_head: &LastTreeHead,
    ) -> Result<AccountData, RequestError<Error>> {
        self.monitor.take().expect("unexpected call to monitor")
    }
}
