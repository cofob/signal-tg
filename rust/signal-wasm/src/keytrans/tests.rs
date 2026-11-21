//! Tests of libsignal `rust/net/chat/src/api/keytrans.rs`, run against the recorded staging responses.

use std::time::SystemTime;

use assert_matches::assert_matches;
use libsignal_keytrans::{KeyTransparency, StoredAccountData, StoredMonitoringData};
use prost::Message as _;

use super::test_support::{
    CHAT_SEARCH_RESPONSE, CHAT_SEARCH_RESPONSE_VALID_AT, staging_config, test_account,
    test_account_data, test_distinguished_tree,
};
use super::verify_ext::KeyTransparencyVerifyExt as _;
use super::*;

const SKIPPED_FIELDS: [&[AccountDataField]; 3] = [
    &[AccountDataField::E164],
    &[AccountDataField::UsernameHash],
    &[AccountDataField::E164, AccountDataField::UsernameHash],
];

fn test_search_response() -> TypedSearchResponse {
    let chat_search_response =
        libsignal_keytrans::ChatSearchResponse::decode(CHAT_SEARCH_RESPONSE).expect("valid response");
    TypedSearchResponse::from_untyped(chat_search_response).expect("valid typed search response")
}

fn valid_at() -> SystemTime {
    SystemTime::UNIX_EPOCH + CHAT_SEARCH_RESPONSE_VALID_AT
}

fn staging_kt() -> KeyTransparency {
    KeyTransparency {
        config: staging_config(),
    }
}

#[test]
fn search_verifies_all_fields() {
    let result = staging_kt().verify_chat_search_response(
        &test_account::aci(),
        &test_account::aci_identity_key(),
        Some(test_account::PHONE_NUMBER),
        Some(test_account::username_hash()),
        Some(test_account_data()),
        test_search_response(),
        Some(&test_distinguished_tree()),
        valid_at(),
    );

    assert_matches!(result, Ok(MaybePartial { missing_fields, .. }) => assert!(missing_fields.is_empty()));
}

#[test]
fn search_rejects_a_different_identity_key() {
    let other_identity_key = {
        let mut bytes = test_account::ACI_IDENTITY_KEY_BYTES.to_vec();
        bytes[1] ^= 1;
        PublicKey::deserialize(&bytes).expect("a valid key")
    };
    let result = staging_kt().verify_chat_search_response(
        &test_account::aci(),
        &other_identity_key,
        Some(test_account::PHONE_NUMBER),
        Some(test_account::username_hash()),
        Some(test_account_data()),
        test_search_response(),
        Some(&test_distinguished_tree()),
        valid_at(),
    );

    assert_matches!(result, Err(Error::VerificationFailed(_)));
}

#[test]
fn search_rejects_the_production_keys() {
    let kt = KeyTransparency {
        config: production_config(),
    };
    let result = kt.verify_chat_search_response(
        &test_account::aci(),
        &test_account::aci_identity_key(),
        Some(test_account::PHONE_NUMBER),
        Some(test_account::username_hash()),
        Some(test_account_data()),
        test_search_response(),
        Some(&test_distinguished_tree()),
        valid_at(),
    );

    assert_matches!(result, Err(Error::VerificationFailed(_)));
}

#[test]
fn search_returns_data_not_requested() {
    for skip in SKIPPED_FIELDS {
        let mut e164 = Some(test_account::PHONE_NUMBER);
        let mut username_hash = Some(test_account::username_hash());

        for what in skip {
            match what {
                AccountDataField::E164 => e164 = None,
                AccountDataField::UsernameHash => username_hash = None,
            }
        }

        let result = staging_kt().verify_chat_search_response(
            &test_account::aci(),
            &test_account::aci_identity_key(),
            e164,
            username_hash,
            Some(test_account_data()),
            test_search_response(),
            Some(&test_distinguished_tree()),
            valid_at(),
        );

        assert_matches!(result, Err(Error::InvalidResponse(_)), "{skip:?}");
    }
}

#[test]
fn search_does_not_return_requested_data() {
    for skip in SKIPPED_FIELDS {
        let mut search_response = test_search_response();
        for what in skip {
            match what {
                AccountDataField::E164 => search_response.e164_search_response = None,
                AccountDataField::UsernameHash => search_response.username_hash_search_response = None,
            }
        }

        let result = staging_kt().verify_chat_search_response(
            &test_account::aci(),
            &test_account::aci_identity_key(),
            Some(test_account::PHONE_NUMBER),
            Some(test_account::username_hash()),
            Some(test_account_data()),
            search_response,
            Some(&test_distinguished_tree()),
            valid_at(),
        );

        assert_matches!(result, Ok(MaybePartial { missing_fields, .. }) =>
            assert_eq!(skip.to_vec(), missing_fields.into_iter().collect::<Vec<_>>())
        );
    }
}

#[test]
fn reset_account_data_field() {
    for field in [AccountDataField::E164, AccountDataField::UsernameHash] {
        let field_data = StoredMonitoringData::default();
        let data = StoredAccountData {
            aci: None,
            e164: Some(StoredMonitoringData {
                pos: 1,
                ..field_data.clone()
            }),
            username_hash: Some(StoredMonitoringData {
                pos: 2,
                ..field_data
            }),
            last_tree_head: None,
        };

        let updated = data.clone().reset(field);

        match field {
            AccountDataField::E164 => {
                assert!(updated.e164.is_none());
                assert_matches!(updated.username_hash, Some(StoredMonitoringData { pos: 2, .. }));
            }
            AccountDataField::UsernameHash => {
                assert_matches!(updated.e164, Some(StoredMonitoringData { pos: 1, .. }));
                assert!(updated.username_hash.is_none());
            }
        }
    }
}

#[test]
fn account_data_field_round_trips_through_its_number() {
    for field in [AccountDataField::E164, AccountDataField::UsernameHash] {
        assert_eq!(AccountDataField::try_from(field as u8), Ok(field));
    }
    assert_eq!(AccountDataField::try_from(2), Err(2));
}

#[test]
fn search_keys_have_the_chat_server_prefixes() {
    assert_eq!(
        test_account::aci().as_search_key(),
        [b"a".as_slice(), test_account::ACI.as_bytes()].concat()
    );
    assert_eq!(test_account::PHONE_NUMBER.as_search_key(), b"n+18005550100");
    assert_eq!(
        test_account::username_hash().as_search_key(),
        [b"u".as_slice(), test_account::USERNAME_HASH].concat()
    );
}

#[test]
fn production_config_keys_are_valid() {
    // Panics on key material that is not a point of the curve
    let _ = production_config();
}
