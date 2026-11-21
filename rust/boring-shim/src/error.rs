use std::fmt;

/// An error from parsing or verification; BoringSSL's error queue holds a single message here
#[derive(Clone, Debug)]
pub struct ErrorStack(String);

impl ErrorStack {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for ErrorStack {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ErrorStack {}

impl From<::asn1::ParseError> for ErrorStack {
    fn from(err: ::asn1::ParseError) -> Self {
        Self(format!("ASN.1 parse error: {err}"))
    }
}
