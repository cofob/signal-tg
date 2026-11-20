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

/// Plaintext moved into rustls at a time; rustls buffers at most 64 KiB of outgoing data
const SEND_PIECE_SIZE: usize = 16 * 1024;

#[wasm_bindgen]
pub struct TlsClient {
    connection: ClientConnection,
    // Plaintext from `send` that rustls has not accepted yet: it is held during the handshake and
    // moved over in pieces by `take_outgoing`
    pending_plaintext: Vec<u8>,
}

#[wasm_bindgen]
impl TlsClient {
    /// `trust_anchors` are DER certificates; only chains to them are accepted. `alpn_protocols` are
    /// offered in order of preference.
    #[wasm_bindgen(constructor)]
    pub fn new(
        server_name: String,
        trust_anchors: Vec<js_sys::Uint8Array>,
        alpn_protocols: Vec<String>,
    ) -> JsResult<TlsClient> {
        let operation = "TlsClient_New";
        let mut roots = RootCertStore::empty();
        for anchor in trust_anchors {
            roots
                .add(CertificateDer::from(anchor.to_vec()))
                .or_throw_generic(operation)?;
        }
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .or_throw_generic(operation)?
            .with_root_certificates(roots)
            .with_no_client_auth();
        config.alpn_protocols = alpn_protocols.into_iter().map(String::into_bytes).collect();
        let server_name = ServerName::try_from(server_name).or_throw_generic(operation)?;
        let connection =
            ClientConnection::new(Arc::new(config), server_name).or_throw_generic(operation)?;
        Ok(TlsClient { connection, pending_plaintext: Vec::new() })
    }

    /// Processes bytes from the peer and returns the decrypted application data
    pub fn receive(&mut self, mut data: &[u8]) -> JsResult<Vec<u8>> {
        let operation = "TlsClient_Receive";
        let mut plaintext = Vec::new();
        // rustls holds at most 16 KiB of received plaintext, so it is drained after each read
        while !data.is_empty() {
            let read_length = self.connection.read_tls(&mut data).or_throw_generic(operation)?;
            self.connection.process_new_packets().or_throw_generic(operation)?;
            match self.connection.reader().read_to_end(&mut plaintext) {
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(error) => return Err(crate::error::generic_error(error, operation)),
            }
            // Nothing more is read after `close_notify`
            if read_length == 0 {
                break;
            }
        }
        Ok(plaintext)
    }

    /// Queues application data of any length; it is sent after the handshake completes
    pub fn send(&mut self, data: &[u8]) {
        self.pending_plaintext.extend_from_slice(data);
    }

    /// Returns TLS records to write to the tunnel
    #[wasm_bindgen(js_name = takeOutgoing)]
    pub fn take_outgoing(&mut self) -> JsResult<Vec<u8>> {
        let operation = "TlsClient_TakeOutgoing";
        let mut output = Vec::new();
        let mut offset = 0;
        loop {
            while self.connection.wants_write() {
                self.connection.write_tls(&mut output).or_throw_generic(operation)?;
            }
            if self.connection.is_handshaking() || offset == self.pending_plaintext.len() {
                break;
            }
            let end = (offset + SEND_PIECE_SIZE).min(self.pending_plaintext.len());
            offset += self
                .connection
                .writer()
                .write(&self.pending_plaintext[offset..end])
                .or_throw_generic(operation)?;
        }
        self.pending_plaintext.drain(..offset);
        Ok(output)
    }

    #[wasm_bindgen(js_name = isHandshaking)]
    pub fn is_handshaking(&self) -> bool {
        self.connection.is_handshaking()
    }

    /// The protocol the server chose from `alpn_protocols`, once the handshake completes
    #[wasm_bindgen(js_name = alpnProtocol)]
    pub fn alpn_protocol(&self) -> Option<String> {
        self.connection
            .alpn_protocol()
            .map(|protocol| String::from_utf8_lossy(protocol).into_owned())
    }

    /// Queues `close_notify`; call `takeOutgoing` afterwards
    pub fn close(&mut self) {
        self.connection.send_close_notify();
    }
}
