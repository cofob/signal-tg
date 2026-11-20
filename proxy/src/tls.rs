//! Checks the TLS ClientHello that starts every tunnel, so the tunnel only carries TLS to the
//! requested Signal host. The check reads record and handshake framing and the `server_name` and
//! `encrypted_client_hello` extensions (RFC 8446 section 4.1.2, RFC 6066 section 3); it never sees
//! encrypted data.

/// Largest ClientHello the tunnel buffers, including TLS record headers
pub const MAX_CLIENT_HELLO_BYTES: usize = 16 << 10;

const RECORD_HEADER_BYTES: usize = 5;
const HANDSHAKE_HEADER_BYTES: usize = 4;
const MAX_RECORD_BYTES: usize = 1 << 14;
const CONTENT_TYPE_HANDSHAKE: u8 = 22;
const TLS_MAJOR_VERSION: u8 = 3;
const HANDSHAKE_TYPE_CLIENT_HELLO: u8 = 1;
/// `legacy_version` and `random`
const CLIENT_HELLO_FIXED_BYTES: usize = 2 + 32;
const MAX_SESSION_ID_BYTES: usize = 32;
const EXTENSION_SERVER_NAME: u16 = 0;
const EXTENSION_ENCRYPTED_CLIENT_HELLO: u16 = 0xfe0d;
const NAME_TYPE_HOST_NAME: u8 = 0;

const MALFORMED: &str = "malformed ClientHello";

pub enum ClientHello {
    /// More bytes are needed
    Incomplete,
    Valid,
}

/// Checks that `data` starts with a ClientHello whose only server name is `host`. The ClientHello
/// may span several handshake records; bytes after it are not inspected.
pub fn check_client_hello(data: &[u8], host: &str) -> Result<ClientHello, &'static str> {
    // Reassembled handshake message, no larger than `data`
    let mut message = Vec::new();
    let mut records = data;
    let mut offset = 0;
    loop {
        let Some((header, rest)) = records.split_first_chunk::<RECORD_HEADER_BYTES>() else {
            return Ok(ClientHello::Incomplete);
        };
        let [content_type, major_version, _, length @ ..] = *header;
        if content_type != CONTENT_TYPE_HANDSHAKE || major_version != TLS_MAJOR_VERSION {
            return Err("not a TLS handshake");
        }
        let length = usize::from(u16::from_be_bytes(length));
        if length == 0 || length > MAX_RECORD_BYTES {
            return Err(MALFORMED);
        }
        offset += RECORD_HEADER_BYTES + length;
        if offset > MAX_CLIENT_HELLO_BYTES {
            return Err("ClientHello too large");
        }
        let Some((fragment, rest)) = rest.split_at_checked(length) else {
            return Ok(ClientHello::Incomplete);
        };
        message.extend_from_slice(fragment);
        records = rest;

        if let Some(result) = check_handshake_message(&message, host) {
            return result.map(|()| ClientHello::Valid);
        }
    }
}

/// Returns `None` while the handshake message is incomplete
fn check_handshake_message(message: &[u8], host: &str) -> Option<Result<(), &'static str>> {
    let (header, body) = message.split_first_chunk::<HANDSHAKE_HEADER_BYTES>()?;
    let [message_type, length @ ..] = *header;
    if message_type != HANDSHAKE_TYPE_CLIENT_HELLO {
        return Some(Err("not a ClientHello"));
    }
    let [high, middle, low] = length;
    let length = usize::from(u16::from_be_bytes([middle, low])) | usize::from(high) << 16;
    if HANDSHAKE_HEADER_BYTES + length > MAX_CLIENT_HELLO_BYTES {
        return Some(Err("ClientHello too large"));
    }
    Some(check_client_hello_body(body.get(..length)?, host))
}

fn check_client_hello_body(body: &[u8], host: &str) -> Result<(), &'static str> {
    let mut hello = Reader(body);
    hello
        .read_bytes(CLIENT_HELLO_FIXED_BYTES)
        .ok_or(MALFORMED)?;
    let session_id = hello.read_u8_vec().ok_or(MALFORMED)?;
    if session_id.len() > MAX_SESSION_ID_BYTES {
        return Err(MALFORMED);
    }
    hello.read_u16_vec().ok_or(MALFORMED)?; // `cipher_suites`
    hello.read_u8_vec().ok_or(MALFORMED)?; // `legacy_compression_methods`
    if hello.0.is_empty() {
        return Err("missing server name");
    }
    let mut extensions = Reader(hello.read_u16_vec().ok_or(MALFORMED)?);
    if !hello.0.is_empty() {
        return Err(MALFORMED);
    }

    let mut server_name = None;
    while !extensions.0.is_empty() {
        let extension_type = extensions.read_u16().ok_or(MALFORMED)?;
        let data = extensions.read_u16_vec().ok_or(MALFORMED)?;
        match extension_type {
            EXTENSION_ENCRYPTED_CLIENT_HELLO => return Err("encrypted ClientHello"),
            EXTENSION_SERVER_NAME if server_name.replace(data).is_some() => {
                return Err("duplicate server name");
            }
            _ => {}
        }
    }

    let name = read_host_name(server_name.ok_or("missing server name")?)?;
    // `host` is a lowercase DNS name from the allowlist, so a match also rules out non-ASCII names,
    // IP literals and a trailing dot
    if !name.eq_ignore_ascii_case(host.as_bytes()) {
        return Err("server name mismatch");
    }
    Ok(())
}

/// Reads a `ServerNameList` that holds exactly one `host_name`
fn read_host_name(extension: &[u8]) -> Result<&[u8], &'static str> {
    let mut extension = Reader(extension);
    let mut names = Reader(extension.read_u16_vec().ok_or(MALFORMED)?);
    if !extension.0.is_empty() {
        return Err(MALFORMED);
    }
    let name_type = names.read_u8().ok_or(MALFORMED)?;
    let name = names.read_u16_vec().ok_or(MALFORMED)?;
    if name_type != NAME_TYPE_HOST_NAME || !names.0.is_empty() {
        return Err("server name must be a single host name");
    }
    Ok(name)
}

/// Bounds-checked big-endian reads that return `None` past the end
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn read_bytes(&mut self, count: usize) -> Option<&'a [u8]> {
        let (bytes, rest) = self.0.split_at_checked(count)?;
        self.0 = rest;
        Some(bytes)
    }

    fn read_u8(&mut self) -> Option<u8> {
        let (&byte, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(byte)
    }

    fn read_u16(&mut self) -> Option<u16> {
        let (&bytes, rest) = self.0.split_first_chunk::<2>()?;
        self.0 = rest;
        Some(u16::from_be_bytes(bytes))
    }

    fn read_u8_vec(&mut self) -> Option<&'a [u8]> {
        let length = self.read_u8()?;
        self.read_bytes(usize::from(length))
    }

    fn read_u16_vec(&mut self) -> Option<&'a [u8]> {
        let length = self.read_u16()?;
        self.read_bytes(usize::from(length))
    }
}
