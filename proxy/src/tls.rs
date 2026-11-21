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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::panic)]
mod tests {
    use super::*;

    const HOST: &str = "chat.signal.org";

    /// Number of mutated hellos in `mutations_never_pass_for_another_host`
    const MUTATION_ROUNDS: usize = 200_000;

    /// A TLS 1.3 ClientHello message with the given extensions, as `(type, data)` pairs
    fn build_hello_message(extensions: &[(u16, Vec<u8>)]) -> Vec<u8> {
        let mut body = vec![3, 3];
        body.extend([7; 32]); // `random`
        body.push(32); // `legacy_session_id`
        body.extend([9; 32]);
        body.extend([0, 4, 0x13, 0x01, 0x13, 0x02]); // `cipher_suites`
        body.extend([1, 0]); // `legacy_compression_methods`
        let mut encoded = Vec::new();
        for (extension_type, data) in extensions {
            encoded.extend(extension_type.to_be_bytes());
            encoded.extend(u16::try_from(data.len()).unwrap().to_be_bytes());
            encoded.extend(data);
        }
        body.extend(u16::try_from(encoded.len()).unwrap().to_be_bytes());
        body.extend(encoded);

        let mut message = vec![HANDSHAKE_TYPE_CLIENT_HELLO];
        message.extend(&u32::try_from(body.len()).unwrap().to_be_bytes()[1..]);
        message.extend(body);
        message
    }

    fn build_record(fragment: &[u8]) -> Vec<u8> {
        let mut record = vec![CONTENT_TYPE_HANDSHAKE, 3, 1];
        record.extend(u16::try_from(fragment.len()).unwrap().to_be_bytes());
        record.extend(fragment);
        record
    }

    fn build_server_name(names: &[(u8, &str)]) -> (u16, Vec<u8>) {
        let mut list = Vec::new();
        for (name_type, name) in names {
            list.push(*name_type);
            list.extend(u16::try_from(name.len()).unwrap().to_be_bytes());
            list.extend(name.as_bytes());
        }
        let mut data = u16::try_from(list.len()).unwrap().to_be_bytes().to_vec();
        data.extend(list);
        (EXTENSION_SERVER_NAME, data)
    }

    fn build_hello(name: &str) -> Vec<u8> {
        let extensions = [(0x002b, vec![2, 3, 4]), build_server_name(&[(0, name)])];
        build_record(&build_hello_message(&extensions))
    }

    fn build_hello_with(extensions: &[(u16, Vec<u8>)]) -> Vec<u8> {
        build_record(&build_hello_message(extensions))
    }

    fn check(data: &[u8]) -> Result<bool, &'static str> {
        check_client_hello(data, HOST).map(|hello| matches!(hello, ClientHello::Valid))
    }

    #[test]
    fn accepts_the_requested_host() {
        assert_eq!(check(&build_hello(HOST)), Ok(true));
        // Host names are case-insensitive (RFC 6066 section 3); the tunnel connects to the allowlist entry
        assert_eq!(check(&build_hello("Chat.Signal.ORG")), Ok(true));
    }

    #[test]
    fn rejects_other_names() {
        for name in [
            "cdn.signal.org",
            "chat.signal.org.",
            ".chat.signal.org",
            "chat.signal.org.evil.example",
            "evil.example",
            "xchat.signal.org",
            "chat.signal.or",
            "chat.signal.org\0",
            "chat.signal.org\0.evil.example",
            "ch\u{430}t.signal.org", // Cyrillic `а`
            "93.184.216.34",
            "[::1]",
            "",
        ] {
            assert!(check(&build_hello(name)).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn rejects_malformed_server_name_extensions() {
        // No `server_name` at all, and no extensions at all
        assert!(check(&build_hello_with(&[(0x002b, vec![2, 3, 4])])).is_err());
        assert!(check(&build_hello_with(&[])).is_err());
        // Two `server_name` extensions, with the allowed name in either position
        let allowed = build_server_name(&[(0, HOST)]);
        let other = build_server_name(&[(0, "evil.example")]);
        assert!(check(&build_hello_with(&[allowed.clone(), other.clone()])).is_err());
        assert!(check(&build_hello_with(&[other, allowed.clone()])).is_err());
        // Two names in one list, and a name type that is not `host_name`
        let two = build_server_name(&[(0, HOST), (0, "evil.example")]);
        assert!(check(&build_hello_with(&[two])).is_err());
        let two = build_server_name(&[(0, "evil.example"), (0, HOST)]);
        assert!(check(&build_hello_with(&[two])).is_err());
        assert!(check(&build_hello_with(&[build_server_name(&[(1, HOST)])])).is_err());
        // Trailing bytes after the list
        let (extension_type, mut data) = allowed.clone();
        data.push(0);
        assert!(check(&build_hello_with(&[(extension_type, data)])).is_err());
        // Encrypted ClientHello hides the real name
        let ech = (EXTENSION_ENCRYPTED_CLIENT_HELLO, vec![0; 8]);
        assert!(check(&build_hello_with(&[allowed, ech])).is_err());
    }

    #[test]
    fn rejects_other_traffic() {
        assert!(check(b"GET / HTTP/1.1\r\nHost: chat.signal.org\r\n\r\n").is_err());
        // An alert or application data record
        assert!(check(&[21, 3, 3, 0, 2, 1, 0]).is_err());
        assert!(check(&[23, 3, 3, 0, 1, 0]).is_err());
        // Another handshake message type, an empty record and an oversized record
        assert!(check(&build_record(&[2, 0, 0, 0])).is_err());
        assert!(check(&[CONTENT_TYPE_HANDSHAKE, 3, 3, 0, 0]).is_err());
        assert!(check(&[CONTENT_TYPE_HANDSHAKE, 3, 3, 0xff, 0xff]).is_err());
    }

    #[test]
    fn waits_for_a_complete_hello() {
        let hello = build_hello(HOST);
        for length in 0..hello.len() {
            let prefix = hello.get(..length).unwrap();
            assert!(
                matches!(
                    check_client_hello(prefix, HOST),
                    Ok(ClientHello::Incomplete)
                ),
                "a prefix of {length} bytes is not incomplete"
            );
        }
    }

    #[test]
    fn ignores_bytes_after_the_hello() {
        let mut data = build_hello(HOST);
        data.extend(b"anything");
        assert_eq!(check(&data), Ok(true));
    }

    #[test]
    fn joins_a_hello_split_across_records() {
        let message =
            build_hello_message(&[(0x002b, vec![2, 3, 4]), build_server_name(&[(0, HOST)])]);
        for split in 1..message.len() {
            let (first, second) = message.split_at(split);
            let mut data = build_record(first);
            data.extend(build_record(second));
            assert_eq!(check(&data), Ok(true), "split at {split}");
        }
        // One byte per record
        let data: Vec<u8> = message
            .iter()
            .flat_map(|byte| build_record(&[*byte]))
            .collect();
        assert_eq!(check(&data), Ok(true));
    }

    #[test]
    fn bounds_the_hello_size() {
        // The largest ClientHello, record header included, and one byte more
        let name = build_server_name(&[(0, HOST)]);
        let empty_length = build_hello_message(&[(0x0015, vec![]), name.clone()]).len();
        let largest = MAX_CLIENT_HELLO_BYTES - RECORD_HEADER_BYTES;
        let message =
            build_hello_message(&[(0x0015, vec![0; largest - empty_length]), name.clone()]);
        assert_eq!(message.len(), largest);
        assert_eq!(check(&build_record(&message)), Ok(true));
        let message = build_hello_message(&[(0x0015, vec![0; largest - empty_length + 1]), name]);
        assert!(check(&build_record(&message)).is_err());

        // Records that go on past the limit without completing the message are refused
        let mut data = Vec::new();
        for _ in 0..=MAX_CLIENT_HELLO_BYTES / MAX_RECORD_BYTES {
            let mut fragment = vec![HANDSHAKE_TYPE_CLIENT_HELLO, 0xff, 0xff, 0xff];
            fragment.resize(MAX_RECORD_BYTES, 0);
            data.extend(build_record(&fragment));
        }
        assert!(check(&data).is_err());
    }

    /// A small xorshift generator, so the mutations repeat on every run
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, limit: usize) -> usize {
            usize::try_from(self.next() % u64::try_from(limit).unwrap()).unwrap()
        }
    }

    /// Mutates valid and invalid hellos at random: the parser must not panic, and a hello that it
    /// accepts must still hold the host name
    #[test]
    fn mutations_never_pass_for_another_host() {
        let seeds = [
            build_hello(HOST),
            build_hello("cdn.signal.org"),
            build_hello_with(&[build_server_name(&[(0, HOST)]), (0x002b, vec![2, 3, 4])]),
        ];
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        let mut accepted = 0;
        for _ in 0..MUTATION_ROUNDS {
            let mut data = seeds.get(rng.below(seeds.len())).unwrap().clone();
            for _ in 0..=rng.below(4) {
                let position = rng.below(data.len());
                match rng.below(5) {
                    0 => *data.get_mut(position).unwrap() ^= 1 << rng.below(8),
                    1 => *data.get_mut(position).unwrap() = u8::try_from(rng.below(256)).unwrap(),
                    2 => data.truncate(position),
                    3 => data.insert(position, u8::try_from(rng.below(256)).unwrap()),
                    _ => {
                        data.remove(position);
                    }
                }
                if data.is_empty() {
                    break;
                }
            }
            if let Ok(ClientHello::Valid) = check_client_hello(&data, HOST) {
                accepted += 1;
                assert!(
                    data.windows(HOST.len())
                        .any(|window| window.eq_ignore_ascii_case(HOST.as_bytes())),
                    "accepted without the host name: {data:?}"
                );
            }
        }
        // The mutations still reach the accepting path
        assert!(accepted > 0);
    }
}
