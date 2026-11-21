use std::cmp::Ordering;
use std::ffi::c_int;
use std::ops::Deref;

use crate::error::ErrorStack;
use crate::nid::Nid;

const DAY_SECONDS: i64 = 24 * 60 * 60;

/// A point in time with second precision, held as seconds since the Unix epoch
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asn1TimeRef {
    unix: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asn1Time(Asn1TimeRef);

/// The difference `compare - self` of [`Asn1TimeRef::diff`], as in `ASN1_TIME_diff`
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeDiff {
    pub days: c_int,
    pub secs: c_int,
}

impl Asn1Time {
    pub fn from_unix(time: i64) -> Result<Asn1Time, ErrorStack> {
        Ok(Asn1Time(Asn1TimeRef { unix: time }))
    }
}

impl Deref for Asn1Time {
    type Target = Asn1TimeRef;

    fn deref(&self) -> &Asn1TimeRef {
        &self.0
    }
}

impl Asn1TimeRef {
    pub(crate) fn from_unix_seconds(unix: i64) -> Self {
        Self { unix }
    }

    pub fn diff(&self, compare: &Self) -> Result<TimeDiff, ErrorStack> {
        let delta = compare.unix - self.unix;
        let days = c_int::try_from(delta / DAY_SECONDS).map_err(|_| ErrorStack::new("time difference overflow"))?;
        // The remainder is below a day, so it fits
        let secs = (delta % DAY_SECONDS) as c_int;
        Ok(TimeDiff { days, secs })
    }

    /// `Less` when `self` is earlier than `other`
    pub fn compare(&self, other: &Self) -> Result<Ordering, ErrorStack> {
        Ok(self.unix.cmp(&other.unix))
    }
}

/// The value of a string or OCTET STRING: an extension value or a name attribute
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asn1StringRef {
    tag: ::asn1::Tag,
    data: Vec<u8>,
}

impl Asn1StringRef {
    pub(crate) fn new(tag: ::asn1::Tag, data: Vec<u8>) -> Self {
        Self { tag, data }
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    /// Decodes UTF8String, PrintableString and IA5String values; other string types are rejected
    pub fn as_utf8(&self) -> Result<String, ErrorStack> {
        use ::asn1::SimpleAsn1Readable;

        let is_text = self.tag == ::asn1::Utf8String::TAG
            || self.tag == ::asn1::PrintableString::TAG
            || self.tag == ::asn1::IA5String::TAG;
        if !is_text {
            return Err(ErrorStack::new("unsupported string type"));
        }
        String::from_utf8(self.data.clone()).map_err(|_| ErrorStack::new("invalid UTF-8"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asn1ObjectRef {
    oid: ::asn1::ObjectIdentifier,
}

impl Asn1ObjectRef {
    pub(crate) fn new(oid: ::asn1::ObjectIdentifier) -> Self {
        Self { oid }
    }

    pub(crate) fn oid(&self) -> &::asn1::ObjectIdentifier {
        &self.oid
    }

    pub fn nid(&self) -> Nid {
        Nid::from_oid(&self.oid)
    }

    pub fn oid_string(&self) -> String {
        self.oid.to_string()
    }
}
