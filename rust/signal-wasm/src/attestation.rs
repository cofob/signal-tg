//! Attested Noise connections to SGX enclaves (CDSI and SVR2) and SVR2 PIN hashing
//! (upstream `rust/bridge/shared/src/{cds2,svr2,sgx_session,account_keys}.rs` and
//! `rust/bridge/shared/types/src/sgx_session.rs`).

use attest::client_connection::ClientConnection;
use attest::enclave::{self, Handshake};
use attest::{cds2, svr2};
use libsignal_account_keys::PinHash as LsPinHash;
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt, JsResult};

const MASTER_KEY_LENGTH: usize = 32;
const ENCODED_MASTER_KEY_LENGTH: usize = 48;

enum State {
    ConnectionEstablishment(Handshake),
    Connection(ClientConnection),
    Invalid,
}

/// The client side of an attested connection, from the enclave's attestation message to an established session
#[wasm_bindgen]
pub struct SgxClientState(State);

#[wasm_bindgen]
pub struct PinHash(LsPinHash);

pub(crate) fn system_time(millis: f64) -> std::time::SystemTime {
    std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(millis as u64)
}

pub(crate) fn new_client(handshake: enclave::Result<Handshake>, operation: &str) -> JsResult<SgxClientState> {
    handshake
        .map(|h| SgxClientState(State::ConnectionEstablishment(h)))
        .or_throw_generic(operation)
}

#[wasm_bindgen]
pub fn Cds2ClientState_New(
    mrenclave: &[u8],
    attestation_msg: &[u8],
    current_timestamp: f64,
) -> JsResult<SgxClientState> {
    new_client(
        cds2::new_handshake(mrenclave, attestation_msg, system_time(current_timestamp)),
        "Cds2ClientState_New",
    )
}

#[wasm_bindgen]
pub fn Svr2Client_New(mrenclave: &[u8], attestation_msg: &[u8], current_timestamp: f64) -> JsResult<SgxClientState> {
    new_client(
        svr2::new_handshake_with_raft_config_lookup(mrenclave, attestation_msg, system_time(current_timestamp)),
        "Svr2Client_New",
    )
}

#[wasm_bindgen]
pub fn SgxClientState_InitialRequest(obj: &SgxClientState) -> JsResult<Vec<u8>> {
    match &obj.0 {
        State::ConnectionEstablishment(handshake) => Ok(handshake.initial_request().to_vec()),
        _ => Err(enclave::Error::InvalidBridgeStateError).or_throw_generic("SgxClientState_InitialRequest"),
    }
}

#[wasm_bindgen]
pub fn SgxClientState_CompleteHandshake(cli: &mut SgxClientState, handshake_received: &[u8]) -> JsResult<()> {
    let result = match std::mem::replace(&mut cli.0, State::Invalid) {
        State::ConnectionEstablishment(handshake) => handshake.complete(handshake_received),
        _ => Err(enclave::Error::InvalidBridgeStateError),
    };
    result
        .map(|connection| cli.0 = State::Connection(connection))
        .or_throw_generic("SgxClientState_CompleteHandshake")
}

/// The hash of the Noise handshake, which SVR-B binds a restore request to
#[wasm_bindgen]
pub fn SgxClientState_GetHandshakeHash(cli: &SgxClientState) -> JsResult<Vec<u8>> {
    match &cli.0 {
        State::Connection(connection) => Ok(connection.handshake_hash.clone()),
        _ => Err(enclave::Error::InvalidBridgeStateError).or_throw_generic("SgxClientState_GetHandshakeHash"),
    }
}

#[wasm_bindgen]
pub fn SgxClientState_EstablishedSend(cli: &mut SgxClientState, plaintext_to_send: &[u8]) -> JsResult<Vec<u8>> {
    match &mut cli.0 {
        State::Connection(connection) => connection.send(plaintext_to_send).map_err(enclave::Error::NoiseError),
        _ => Err(enclave::Error::InvalidBridgeStateError),
    }
    .or_throw_generic("SgxClientState_EstablishedSend")
}

#[wasm_bindgen]
pub fn SgxClientState_EstablishedRecv(cli: &mut SgxClientState, received_ciphertext: &[u8]) -> JsResult<Vec<u8>> {
    match &mut cli.0 {
        State::Connection(connection) => connection.recv(received_ciphertext).map_err(enclave::Error::NoiseError),
        _ => Err(enclave::Error::InvalidBridgeStateError),
    }
    .or_throw_generic("SgxClientState_EstablishedRecv")
}

/// Hashes a normalized PIN with the salt of the SVR2 enclave's group and the SVR2 username
#[wasm_bindgen]
pub fn PinHash_FromUsernameMrenclave(pin: &[u8], username: String, mrenclave: &[u8]) -> JsResult<PinHash> {
    let group_id = svr2::lookup_groupid(mrenclave)
        .ok_or("unknown SVR2 enclave")
        .or_throw_generic("PinHash_FromUsernameMrenclave")?;
    LsPinHash::create(pin, &LsPinHash::make_salt(&username, group_id))
        .map(PinHash)
        .or_throw_generic("PinHash_FromUsernameMrenclave")
}

#[wasm_bindgen]
pub fn PinHash_AccessKey(ph: &PinHash) -> Vec<u8> {
    ph.0.access_key.to_vec()
}

/// Encrypts the master key for SVR2 storage as libsignal-net `Svr2_StartMasterKeyBackup` does
#[wasm_bindgen]
pub fn PinHash_EncodeMasterKey(ph: &PinHash, master_key: &[u8]) -> JsResult<Vec<u8>> {
    <[u8; MASTER_KEY_LENGTH]>::try_from(master_key)
        .map(|key| ph.0.encode_master_key(&key).to_vec())
        .or_throw_generic("PinHash_EncodeMasterKey")
}

/// Decrypts the master key that SVR2 restored, as libsignal-net `Svr2_RestoreMasterKey` does
#[wasm_bindgen]
pub fn PinHash_DecodeMasterKey(ph: &PinHash, encoded: &[u8]) -> JsResult<Vec<u8>> {
    <[u8; ENCODED_MASTER_KEY_LENGTH]>::try_from(encoded)
        .ok()
        .and_then(|encoded| ph.0.decode_master_key(&encoded))
        .map(|key| key.to_vec())
        .ok_or("invalid SVR2 data")
        .or_throw_generic("PinHash_DecodeMasterKey")
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use attest::sgx_session::testutil;

    use super::*;

    const ATTEST_DATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../libsignal/rust/attest/tests/data/");
    const YEAR: Duration = Duration::from_secs(365 * 24 * 60 * 60);

    fn read(name: &str) -> Vec<u8> {
        std::fs::read(format!("{ATTEST_DATA}{name}")).unwrap()
    }

    fn timestamp(name: &str) -> SystemTime {
        let bytes: [u8; 8] = read(name).try_into().unwrap();
        SystemTime::UNIX_EPOCH + Duration::from_secs(u64::from_be_bytes(bytes))
    }

    fn millis(time: SystemTime) -> f64 {
        time.duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as f64
    }

    // The recorded attestations come from the staging enclaves, whose constants libsignal keeps
    fn cdsi_handshake(attestation: &[u8], time: SystemTime) -> enclave::Result<Handshake> {
        cds2::new_handshake(&read("cdsi.mrenclave"), attestation, time)
    }

    fn svr2_handshake(attestation: &[u8], time: SystemTime) -> enclave::Result<Handshake> {
        svr2::new_handshake_with_raft_config_lookup(&read("svr2.mrenclave"), attestation, time)
    }

    #[test]
    fn accepts_recorded_attestations() {
        let time = timestamp("cdsi.timestamp");
        let client = Cds2ClientState_New(&read("cdsi.mrenclave"), &read("cdsi.handshakestart"), millis(time));
        assert!(SgxClientState_InitialRequest(&client.unwrap()).is_ok());
        let handshake = cdsi_handshake(&read("cdsi.handshakestart"), time).unwrap();
        assert_eq!(handshake.claims().public_key.as_slice(), read("cdsi.pubkey"));

        let time = timestamp("svr2.timestamp");
        let client = Svr2Client_New(&read("svr2.mrenclave"), &read("svr2.handshakestart"), millis(time));
        assert!(SgxClientState_InitialRequest(&client.unwrap()).is_ok());
    }

    #[test]
    fn rejects_attestations_outside_their_validity() {
        let attestation = read("cdsi.handshakestart");
        assert!(cdsi_handshake(&attestation, timestamp("cdsi.timestamp") + YEAR).is_err());
        assert!(cdsi_handshake(&attestation, timestamp("cdsi.timestamp") - YEAR).is_err());
        let attestation = read("svr2.handshakestart");
        assert!(svr2_handshake(&attestation, timestamp("svr2.timestamp") + YEAR).is_err());
    }

    #[test]
    fn rejects_other_enclaves() {
        let mut mrenclave = read("cdsi.mrenclave");
        mrenclave[0] ^= 1;
        let time = timestamp("cdsi.timestamp");
        assert!(cds2::new_handshake(&mrenclave, &read("cdsi.handshakestart"), time).is_err());
        // An SVR2 attestation for CDSI and the reverse
        assert!(cdsi_handshake(&read("svr2.handshakestart"), timestamp("svr2.timestamp")).is_err());
        assert!(svr2_handshake(&read("cdsi.handshakestart"), time).is_err());
    }

    #[test]
    fn rejects_modified_attestations() {
        let original = read("cdsi.handshakestart");
        let time = timestamp("cdsi.timestamp");
        let positions: Vec<usize> = (0..original.len()).step_by(53).collect();
        let accepted: Vec<usize> = positions
            .iter()
            .copied()
            .filter(|&position| {
                let mut attestation = original.clone();
                attestation[position] ^= 0x01;
                cdsi_handshake(&attestation, time).is_ok()
            })
            .collect();
        // Only unsigned bytes may change: PEM line breaks, JSON whitespace and the endorsement creation time
        assert!(
            accepted.len() * 50 < positions.len(),
            "accepted changes at {accepted:?}"
        );
    }

    #[test]
    fn completes_noise_handshake() {
        let mut server = snow::Builder::new(attest::client_connection::NOISE_PATTERN.parse().unwrap())
            .local_private_key(&testutil::private_key())
            .unwrap()
            .build_responder()
            .unwrap();
        let mut client = SgxClientState(State::ConnectionEstablishment(
            testutil::handshake_from_tests_data().unwrap(),
        ));
        server
            .read_message(&SgxClientState_InitialRequest(&client).unwrap(), &mut [])
            .unwrap();
        let mut response = vec![0; 48];
        server.write_message(&[], &mut response).unwrap();
        SgxClientState_CompleteHandshake(&mut client, &response).unwrap();
        let mut server = server.into_transport_mode().unwrap();

        let request = SgxClientState_EstablishedSend(&mut client, b"request").unwrap();
        let mut payload = vec![0; request.len()];
        let length = server.read_message(&request, &mut payload).unwrap();
        assert_eq!(&payload[..length], b"request");

        let mut reply = vec![0; 64];
        let length = server.write_message(b"reply", &mut reply).unwrap();
        assert_eq!(
            SgxClientState_EstablishedRecv(&mut client, &reply[..length]).unwrap(),
            b"reply"
        );
    }

    #[test]
    fn round_trips_master_key() {
        let pin_hash = PinHash_FromUsernameMrenclave(b"1234", "username".into(), &read("svr2.mrenclave")).unwrap();
        let encoded = PinHash_EncodeMasterKey(&pin_hash, &[9; 32]).unwrap();
        assert_eq!(PinHash_DecodeMasterKey(&pin_hash, &encoded).unwrap(), [9; 32]);
    }
}
