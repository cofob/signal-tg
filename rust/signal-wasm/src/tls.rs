//! TLS client for the tunnel transport.
//!
//! The proxy relays raw TCP bytes, so the browser terminates TLS itself. `TlsClient`
//! is sans-IO: JS feeds bytes received from the tunnel into `receive`, queues plaintext
//! with `send`, and writes `takeOutgoing` back to the tunnel.

use std::io::{Read as _, Write as _};
use std::sync::Arc;

use rustls::client::{ClientConfig, ClientConnection};
use rustls::RootCertStore;
use rustls::pki_types::{CertificateDer, ServerName};
use wasm_bindgen::prelude::*;

use crate::error::{GenericResultExt as _, JsResult};

#[wasm_bindgen]
pub struct TlsClient {
    connection: ClientConnection,
}

#[wasm_bindgen]
impl TlsClient {
    /// `trust_anchors` are DER certificates; only chains to them are accepted.
    #[wasm_bindgen(constructor)]
    pub fn new(server_name: String, trust_anchors: Vec<js_sys::Uint8Array>) -> JsResult<TlsClient> {
        let operation = "TlsClient_New";
        let mut roots = RootCertStore::empty();
        for anchor in trust_anchors {
            roots
                .add(CertificateDer::from(anchor.to_vec()))
                .or_throw_generic(operation)?;
        }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .or_throw_generic(operation)?
            .with_root_certificates(roots)
            .with_no_client_auth();
        let server_name = ServerName::try_from(server_name).or_throw_generic(operation)?;
        let connection =
            ClientConnection::new(Arc::new(config), server_name).or_throw_generic(operation)?;
        Ok(TlsClient { connection })
    }

    /// Processes bytes from the peer and returns the decrypted application data
    pub fn receive(&mut self, mut data: &[u8]) -> JsResult<Vec<u8>> {
        let operation = "TlsClient_Receive";
        while !data.is_empty() {
            self.connection.read_tls(&mut data).or_throw_generic(operation)?;
            self.connection.process_new_packets().or_throw_generic(operation)?;
        }
        let mut plaintext = Vec::new();
        match self.connection.reader().read_to_end(&mut plaintext) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(crate::error::generic_error(error, operation)),
        }
        Ok(plaintext)
    }

    /// Queues application data; it is sent after the handshake completes
    pub fn send(&mut self, data: &[u8]) -> JsResult<()> {
        self.connection.writer().write_all(data).or_throw_generic("TlsClient_Send")
    }

    /// Returns TLS records to write to the tunnel
    #[wasm_bindgen(js_name = takeOutgoing)]
    pub fn take_outgoing(&mut self) -> JsResult<Vec<u8>> {
        let mut output = Vec::new();
        while self.connection.wants_write() {
            self.connection
                .write_tls(&mut output)
                .or_throw_generic("TlsClient_TakeOutgoing")?;
        }
        Ok(output)
    }

    #[wasm_bindgen(js_name = isHandshaking)]
    pub fn is_handshaking(&self) -> bool {
        self.connection.is_handshaking()
    }

    /// Queues `close_notify`; call `takeOutgoing` afterwards
    pub fn close(&mut self) {
        self.connection.send_close_notify();
    }
}
