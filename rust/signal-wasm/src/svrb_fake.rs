//! A SVR-B enclave for the tests of the backup client against a fake server: the server side of the protocol of
//! `rust/svrb/src/lib.rs` (its `TestServer`), for one user. Built with the `test-server` feature only.

use curve25519_dalek::constants::RISTRETTO_BASEPOINT_TABLE;
use curve25519_dalek::ristretto::{CompressedRistretto, RistrettoPoint};
use curve25519_dalek::scalar::Scalar;
use libsignal_svrb::proto::Message as _;
use libsignal_svrb::proto::svrb::{Request4, Response4, request4, response4};
use sha2::Sha512;
use wasm_bindgen::prelude::*;

use crate::error::{JsResult, generic_error};

struct Version {
    auth_commitment: RistrettoPoint,
    oprf_secretshare: Scalar,
    encryption_secretshare: Vec<u8>,
    zero_secretshare: Scalar,
}

/// One user's data in an enclave: the version that the last `Create` stored, and the tries that are left
#[wasm_bindgen]
pub struct SvrBFakeEnclave {
    tries: u32,
    version: Option<(u32, Version)>,
    restore1_blinded: Vec<u8>,
}

fn point(bytes: &[u8]) -> Option<RistrettoPoint> {
    CompressedRistretto::from_slice(bytes).ok()?.decompress()
}

fn scalar(bytes: &[u8]) -> Option<Scalar> {
    Scalar::from_canonical_bytes(bytes.try_into().ok()?).into_option()
}

fn respond(inner: response4::Inner) -> Vec<u8> {
    Response4 { inner: Some(inner), ..Default::default() }.write_to_bytes().expect("serialization succeeds")
}

#[wasm_bindgen]
pub fn SvrBFakeEnclave_New() -> SvrBFakeEnclave {
    SvrBFakeEnclave { tries: 0, version: None, restore1_blinded: Vec::new() }
}

/// Answers one request of a client whose connection has `handshake_hash`
#[wasm_bindgen]
pub fn SvrBFakeEnclave_Handle(
    enclave: &mut SvrBFakeEnclave,
    request: &[u8],
    handshake_hash: &[u8],
) -> JsResult<Vec<u8>> {
    let operation = "SvrBFakeEnclave_Handle";
    let request = Request4::parse_from_bytes(request).map_err(|e| generic_error(e, operation))?;
    let status = |status: response4::Status| status.into();
    match request.inner {
        Some(request4::Inner::Create(create)) => {
            enclave.version = Some((
                create.version,
                Version {
                    auth_commitment: point(&create.auth_commitment)
                        .ok_or_else(|| generic_error("bad commitment", operation))?,
                    oprf_secretshare: scalar(&create.oprf_secretshare)
                        .ok_or_else(|| generic_error("bad share", operation))?,
                    zero_secretshare: scalar(&create.zero_secretshare)
                        .ok_or_else(|| generic_error("bad share", operation))?,
                    encryption_secretshare: create.encryption_secretshare,
                },
            ));
            enclave.tries = create.max_tries;
            Ok(respond(response4::Inner::Create(response4::Create {
                status: status(response4::Status::OK),
                tries_remaining: enclave.tries,
                ..Default::default()
            })))
        }
        Some(request4::Inner::Restore1(restore1)) => {
            let Some((version, state)) = &enclave.version else {
                return Ok(respond(response4::Inner::Restore1(response4::Restore1 {
                    status: status(response4::Status::MISSING),
                    ..Default::default()
                })));
            };
            if enclave.tries == 0 {
                return Ok(respond(response4::Inner::Restore1(response4::Restore1 {
                    status: status(response4::Status::MISSING),
                    ..Default::default()
                })));
            }
            enclave.tries -= 1;
            enclave.restore1_blinded = restore1.blinded.clone();
            let user_point = RistrettoPoint::from_uniform_bytes(&[1u8; 64]);
            let blinded = point(&restore1.blinded).ok_or_else(|| generic_error("bad blinded element", operation))?;
            let element = blinded * state.oprf_secretshare + user_point * state.zero_secretshare;
            Ok(respond(response4::Inner::Restore1(response4::Restore1 {
                status: status(response4::Status::OK),
                tries_remaining: enclave.tries,
                auth: vec![response4::restore1::Auth {
                    version: *version,
                    element: element.compress().to_bytes().to_vec(),
                    ..Default::default()
                }],
                ..Default::default()
            })))
        }
        Some(request4::Inner::Restore2(restore2)) => {
            let Some((_, state)) = &enclave.version else {
                return Ok(respond(response4::Inner::Restore2(response4::Restore2 {
                    status: status(response4::Status::MISSING),
                    ..Default::default()
                })));
            };
            let auth_scalar = scalar(&restore2.auth_scalar).ok_or_else(|| generic_error("bad scalar", operation))?;
            let auth_point = point(&restore2.auth_point).ok_or_else(|| generic_error("bad point", operation))?;
            let hashed = [&restore2.auth_point[..], &enclave.restore1_blinded, handshake_hash].concat();
            let challenge = Scalar::hash_from_bytes::<Sha512>(&hashed);
            let is_valid = RISTRETTO_BASEPOINT_TABLE * &auth_scalar == state.auth_commitment * challenge + auth_point;
            // A wrong password fails here, and the tries it used stay used
            Ok(respond(response4::Inner::Restore2(response4::Restore2 {
                status: status(if is_valid { response4::Status::OK } else { response4::Status::INVALID_REQUEST }),
                encryption_secretshare: if is_valid { state.encryption_secretshare.clone() } else { Vec::new() },
                ..Default::default()
            })))
        }
        Some(request4::Inner::Remove(_)) => {
            enclave.version = None;
            Ok(respond(response4::Inner::Remove(response4::Remove::default())))
        }
        Some(request4::Inner::Query(_)) => Ok(respond(response4::Inner::Query(response4::Query {
            status: status(if enclave.version.is_some() { response4::Status::OK } else { response4::Status::MISSING }),
            tries_remaining: enclave.tries,
            ..Default::default()
        }))),
        _ => Err(generic_error("unsupported request", operation)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::svrb::*;

    const BACKUP_KEY: [u8; 32] = [5; 32];
    const HANDSHAKE_HASH: [u8; 32] = [8; 32];

    /// What a client does against one enclave: the restore of the key that a pair's salt names
    fn restore(enclave: &mut SvrBFakeEnclave, backup_key: &[u8], salt: &[u8]) -> Option<Vec<u8>> {
        let restore1 = SvrBRestore1_New(backup_key, salt).expect("restore1");
        let response1 =
            SvrBFakeEnclave_Handle(enclave, &SvrBRestore1_GetRequest(&restore1), &HANDSHAKE_HASH).expect("r1");
        let restore2 = SvrBRestore1_Restore2(restore1, &response1, &HANDSHAKE_HASH).expect("restore2");
        let response2 =
            SvrBFakeEnclave_Handle(enclave, &SvrBRestore2_GetRequest(&restore2), &HANDSHAKE_HASH).expect("r2");
        Some(SvrBRestore2_Restore(restore2, &response2).expect("restore"))
    }

    #[test]
    fn a_stored_chain_restores_through_the_enclave() {
        let mut enclave = SvrBFakeEnclave_New();
        let chain = SecureValueRecoveryForBackups_CreateNewBackupChain(&BACKUP_KEY).expect("chain");
        let stored = SecureValueRecoveryForBackups_PrepareStore(&BACKUP_KEY, &chain).expect("store");
        // The enclave takes the previous backup's key at the store
        SvrBFakeEnclave_Handle(&mut enclave, &BackupStoreResponse_GetFinalizeRequest(&stored), &HANDSHAKE_HASH)
            .expect("create");

        let metadata = BackupStoreResponse_GetOpaqueMetadata(&stored);
        let salts = SecureValueRecoveryForBackups_GetMetadataSalts(&metadata).expect("salts");
        assert_eq!(salts.len(), 64);

        // The first pair is the key in the enclave; the second is the one the next store sends
        let encryption_salt = restore(&mut enclave, &BACKUP_KEY, &salts[..32]).expect("restored");
        let restored =
            SecureValueRecoveryForBackups_FinishRestore(&BACKUP_KEY, &metadata, 0, &encryption_salt).expect("token");
        assert_eq!(
            BackupRestoreResponse_GetForwardSecrecyToken(&restored),
            BackupStoreResponse_GetForwardSecrecyToken(&stored)
        );
    }
}
