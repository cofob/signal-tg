//! DER parsing of X.509 certificates and CRLs (RFC 5280) into owned values

// The `asn1` derives return its large `ParseError`
#![allow(clippy::result_large_err)]

use ::asn1::{BigInt, BigUint, BitString, ObjectIdentifier, SequenceOf, SetOf, Tag, Tlv, UtcTime, X509GeneralizedTime};

use crate::error::ErrorStack;

const ECDSA_WITH_SHA256: ObjectIdentifier = ::asn1::oid!(1, 2, 840, 10045, 4, 3, 2);
const EC_PUBLIC_KEY: ObjectIdentifier = ::asn1::oid!(1, 2, 840, 10045, 2, 1);
const PRIME256V1: ObjectIdentifier = ::asn1::oid!(1, 2, 840, 10045, 3, 1, 7);
const BASIC_CONSTRAINTS: ObjectIdentifier = ::asn1::oid!(2, 5, 29, 19);
const KEY_USAGE: ObjectIdentifier = ::asn1::oid!(2, 5, 29, 15);
const SUBJECT_KEY_IDENTIFIER: ObjectIdentifier = ::asn1::oid!(2, 5, 29, 14);
const AUTHORITY_KEY_IDENTIFIER: ObjectIdentifier = ::asn1::oid!(2, 5, 29, 35);

// `KeyUsage` bits (RFC 5280 section 4.2.1.3)
pub(crate) const KEY_USAGE_KEY_CERT_SIGN: usize = 5;
pub(crate) const KEY_USAGE_CRL_SIGN: usize = 6;

const X509_V3: u8 = 2;
const CRL_V2: u8 = 1;
const DAY_SECONDS: i64 = 24 * 60 * 60;

#[derive(::asn1::Asn1Read)]
struct RawSigned<'a> {
    tbs: Tlv<'a>,
    signature_algorithm: RawAlgorithm<'a>,
    signature: BitString<'a>,
}

#[derive(::asn1::Asn1Read, PartialEq)]
struct RawAlgorithm<'a> {
    oid: ObjectIdentifier,
    parameters: Option<Tlv<'a>>,
}

#[derive(::asn1::Asn1Read)]
struct RawTbsCertificate<'a> {
    #[explicit(0)]
    #[default(0u8)]
    version: u8,
    serial: BigInt<'a>,
    signature: RawAlgorithm<'a>,
    issuer: Tlv<'a>,
    validity: RawValidity,
    subject: Tlv<'a>,
    spki: RawSpki<'a>,
    #[implicit(1)]
    _issuer_unique_id: Option<BitString<'a>>,
    #[implicit(2)]
    _subject_unique_id: Option<BitString<'a>>,
    #[explicit(3)]
    extensions: Option<SequenceOf<'a, RawExtension<'a>>>,
}

#[derive(::asn1::Asn1Read)]
struct RawValidity {
    not_before: RawTime,
    not_after: RawTime,
}

#[derive(::asn1::Asn1Read)]
enum RawTime {
    Utc(UtcTime),
    Generalized(X509GeneralizedTime),
}

#[derive(::asn1::Asn1Read)]
struct RawSpki<'a> {
    algorithm: RawAlgorithm<'a>,
    public_key: BitString<'a>,
}

#[derive(::asn1::Asn1Read)]
struct RawExtension<'a> {
    oid: ObjectIdentifier,
    #[default(false)]
    critical: bool,
    value: &'a [u8],
}

#[derive(::asn1::Asn1Read)]
struct RawAttribute<'a> {
    oid: ObjectIdentifier,
    value: Tlv<'a>,
}

#[derive(::asn1::Asn1Read)]
struct RawBasicConstraints {
    #[default(false)]
    ca: bool,
    path_length: Option<u64>,
}

#[derive(::asn1::Asn1Read)]
struct RawAuthorityKeyIdentifier<'a> {
    #[implicit(0)]
    key_identifier: Option<&'a [u8]>,
    #[implicit(1)]
    _issuer: Option<::asn1::Sequence<'a>>,
    #[implicit(2)]
    _serial: Option<BigUint<'a>>,
}

#[derive(::asn1::Asn1Read)]
struct RawEcdsaSignature<'a> {
    r: BigUint<'a>,
    s: BigUint<'a>,
}

#[derive(::asn1::Asn1Read)]
struct RawTbsCrl<'a> {
    version: Option<u8>,
    signature: RawAlgorithm<'a>,
    issuer: Tlv<'a>,
    this_update: RawTime,
    next_update: Option<RawTime>,
    revoked: Option<SequenceOf<'a, RawRevoked<'a>>>,
    #[explicit(0)]
    extensions: Option<SequenceOf<'a, RawExtension<'a>>>,
}

#[derive(::asn1::Asn1Read)]
struct RawRevoked<'a> {
    serial: BigInt<'a>,
    _date: RawTime,
    extensions: Option<SequenceOf<'a, RawExtension<'a>>>,
}

#[derive(Clone, Debug)]
pub(crate) struct Extension {
    pub oid: ObjectIdentifier,
    pub is_critical: bool,
    pub value: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct NameEntry {
    pub oid: ObjectIdentifier,
    pub tag: Tag,
    pub data: Vec<u8>,
}

/// An ECDSA P-256 signature with SHA-256 over `signed_data`, or `None` for other algorithms
#[derive(Clone, Debug)]
pub(crate) struct Signature {
    pub signed_data: Vec<u8>,
    pub r: Vec<u8>,
    pub s: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct BasicConstraints {
    pub is_ca: bool,
    pub path_length: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct Certificate {
    pub der: Vec<u8>,
    pub signature: Option<Signature>,
    pub serial: Vec<u8>,
    pub issuer: Vec<u8>,
    pub subject: Vec<u8>,
    pub subject_entries: Vec<NameEntry>,
    pub not_before: i64,
    pub not_after: i64,
    // SEC1 encoding of a P-256 key; `None` for other key types
    pub public_key: Option<Vec<u8>>,
    pub extensions: Vec<Extension>,
    pub basic_constraints: Option<BasicConstraints>,
    pub key_usage: Option<Vec<u8>>,
    pub subject_key_id: Option<Vec<u8>>,
    pub authority_key_id: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub(crate) struct RevokedEntry {
    pub serial: Vec<u8>,
    pub has_critical_extension: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Crl {
    pub der: Vec<u8>,
    pub signature: Option<Signature>,
    pub issuer: Vec<u8>,
    pub this_update: i64,
    pub next_update: Option<i64>,
    pub revoked: Vec<RevokedEntry>,
    pub extensions: Vec<Extension>,
}

impl Certificate {
    pub fn has_key_usage(&self, bit: usize) -> bool {
        self.key_usage.as_deref().is_none_or(|bits| has_bit(bits, bit))
    }

    pub fn is_self_issued(&self) -> bool {
        self.issuer == self.subject
    }
}

pub(crate) fn parse_certificate(data: &[u8]) -> Result<Certificate, ErrorStack> {
    let der = strip_trailing_data(data)?;
    let signed = ::asn1::parse_single::<RawSigned<'_>>(der)?;
    let tbs = signed.tbs.parse::<RawTbsCertificate<'_>>()?;
    if tbs.version > X509_V3 {
        return Err(ErrorStack::new("unsupported certificate version"));
    }
    let extensions = collect_extensions(tbs.extensions)?;
    if !extensions.is_empty() && tbs.version != X509_V3 {
        return Err(ErrorStack::new("extensions in a certificate before version 3"));
    }

    let mut basic_constraints = None;
    let mut key_usage = None;
    let mut subject_key_id = None;
    let mut authority_key_id = None;
    for extension in &extensions {
        let value = extension.value.as_slice();
        if extension.oid == BASIC_CONSTRAINTS {
            let raw = ::asn1::parse_single::<RawBasicConstraints>(value)?;
            basic_constraints = Some(BasicConstraints {
                is_ca: raw.ca,
                path_length: raw.path_length,
            });
        } else if extension.oid == KEY_USAGE {
            key_usage = Some(::asn1::parse_single::<BitString<'_>>(value)?.as_bytes().to_vec());
        } else if extension.oid == SUBJECT_KEY_IDENTIFIER {
            subject_key_id = Some(::asn1::parse_single::<&[u8]>(value)?.to_vec());
        } else if extension.oid == AUTHORITY_KEY_IDENTIFIER {
            let raw = ::asn1::parse_single::<RawAuthorityKeyIdentifier<'_>>(value)?;
            authority_key_id = raw.key_identifier.map(<[u8]>::to_vec);
        }
    }

    let is_ec_p256 = tbs.spki.algorithm.oid == EC_PUBLIC_KEY
        && tbs
            .spki
            .algorithm
            .parameters
            .as_ref()
            .and_then(|p| p.parse::<ObjectIdentifier>().ok())
            == Some(PRIME256V1);

    Ok(Certificate {
        der: der.to_vec(),
        signature: parse_signature(&signed, &tbs.signature),
        serial: tbs.serial.as_bytes().to_vec(),
        issuer: tbs.issuer.full_data().to_vec(),
        subject: tbs.subject.full_data().to_vec(),
        subject_entries: parse_name(tbs.subject)?,
        not_before: time_to_unix(&tbs.validity.not_before),
        not_after: time_to_unix(&tbs.validity.not_after),
        public_key: (is_ec_p256 && tbs.spki.public_key.padding_bits() == 0)
            .then(|| tbs.spki.public_key.as_bytes().to_vec()),
        extensions,
        basic_constraints,
        key_usage,
        subject_key_id,
        authority_key_id,
    })
}

pub(crate) fn parse_crl(data: &[u8]) -> Result<Crl, ErrorStack> {
    let der = strip_trailing_data(data)?;
    let signed = ::asn1::parse_single::<RawSigned<'_>>(der)?;
    let tbs = signed.tbs.parse::<RawTbsCrl<'_>>()?;
    if tbs.version.is_some_and(|version| version != CRL_V2) {
        return Err(ErrorStack::new("unsupported CRL version"));
    }
    let revoked = match tbs.revoked {
        Some(entries) => entries
            .map(|entry| {
                Ok(RevokedEntry {
                    serial: entry.serial.as_bytes().to_vec(),
                    has_critical_extension: collect_extensions(entry.extensions)?.iter().any(|e| e.is_critical),
                })
            })
            .collect::<Result<Vec<_>, ErrorStack>>()?,
        None => Vec::new(),
    };
    Ok(Crl {
        der: der.to_vec(),
        signature: parse_signature(&signed, &tbs.signature),
        issuer: tbs.issuer.full_data().to_vec(),
        this_update: time_to_unix(&tbs.this_update),
        next_update: tbs.next_update.as_ref().map(time_to_unix),
        revoked,
        extensions: collect_extensions(tbs.extensions)?,
    })
}

/// Splits concatenated PEM `CERTIFICATE` blocks into DER, ignoring text outside the blocks
pub(crate) fn parse_pem_certificates(pem: &[u8]) -> Result<Vec<Vec<u8>>, ErrorStack> {
    use base64::Engine as _;

    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";

    let text = std::str::from_utf8(pem).map_err(|_| ErrorStack::new("PEM is not text"))?;
    let mut ders = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(BEGIN) {
        let body_start = start + BEGIN.len();
        let body_length = rest[body_start..]
            .find(END)
            .ok_or_else(|| ErrorStack::new("unterminated PEM block"))?;
        let body: String = rest[body_start..body_start + body_length]
            .chars()
            .filter(|c| !c.is_ascii_whitespace())
            .collect();
        let der = base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|_| ErrorStack::new("invalid PEM base64"))?;
        ders.push(der);
        rest = &rest[body_start + body_length + END.len()..];
    }
    Ok(ders)
}

/// The first DER element of `data`: BoringSSL's `d2i_*` functions ignore what follows it, such as a NUL terminator
fn strip_trailing_data(data: &[u8]) -> Result<&[u8], ErrorStack> {
    Ok(::asn1::strip_tlv(data)?.0.full_data())
}

pub(crate) fn has_bit(bits: &[u8], bit: usize) -> bool {
    bits.get(bit / 8).is_some_and(|byte| byte & (0x80 >> (bit % 8)) != 0)
}

/// The signature when the outer and signed algorithms are the same ECDSA with SHA-256 without parameters
fn parse_signature(signed: &RawSigned<'_>, signed_algorithm: &RawAlgorithm<'_>) -> Option<Signature> {
    let algorithm = &signed.signature_algorithm;
    if algorithm != signed_algorithm || algorithm.oid != ECDSA_WITH_SHA256 || algorithm.parameters.is_some() {
        return None;
    }
    if signed.signature.padding_bits() != 0 {
        return None;
    }
    let raw = ::asn1::parse_single::<RawEcdsaSignature<'_>>(signed.signature.as_bytes()).ok()?;
    Some(Signature {
        signed_data: signed.tbs.full_data().to_vec(),
        r: raw.r.as_bytes().to_vec(),
        s: raw.s.as_bytes().to_vec(),
    })
}

/// Collects extensions, rejecting repeated ones as BoringSSL does
fn collect_extensions(raw: Option<SequenceOf<'_, RawExtension<'_>>>) -> Result<Vec<Extension>, ErrorStack> {
    let mut extensions: Vec<Extension> = Vec::new();
    for extension in raw.into_iter().flatten() {
        if extensions.iter().any(|e| e.oid == extension.oid) {
            return Err(ErrorStack::new("repeated extension"));
        }
        extensions.push(Extension {
            oid: extension.oid,
            is_critical: extension.critical,
            value: extension.value.to_vec(),
        });
    }
    Ok(extensions)
}

fn parse_name(name: Tlv<'_>) -> Result<Vec<NameEntry>, ErrorStack> {
    let rdns = name.parse::<SequenceOf<'_, SetOf<'_, RawAttribute<'_>>>>()?;
    Ok(rdns
        .flatten()
        .map(|attribute| NameEntry {
            oid: attribute.oid,
            tag: attribute.value.tag(),
            data: attribute.value.data().to_vec(),
        })
        .collect())
}

fn time_to_unix(time: &RawTime) -> i64 {
    let datetime = match time {
        RawTime::Utc(time) => time.as_datetime(),
        RawTime::Generalized(time) => time.as_datetime(),
    };
    let days = days_from_civil(
        i64::from(datetime.year()),
        datetime.month().into(),
        datetime.day().into(),
    );
    days * DAY_SECONDS
        + i64::from(datetime.hour()) * 3600
        + i64::from(datetime.minute()) * 60
        + i64::from(datetime.second())
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's `days_from_civil`)
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2024, 2, 29), 19_782);
    }

    #[test]
    fn reads_bits() {
        assert!(has_bit(&[0b0000_0110], KEY_USAGE_KEY_CERT_SIGN));
        assert!(has_bit(&[0b0000_0110], KEY_USAGE_CRL_SIGN));
        assert!(!has_bit(&[0b1000_0000], KEY_USAGE_CRL_SIGN));
        assert!(!has_bit(&[], 0));
    }
}
