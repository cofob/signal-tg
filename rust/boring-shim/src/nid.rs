use std::ffi::c_int;

/// An object identifier known by name, with BoringSSL's numeric values; unknown OIDs are [`Nid::UNDEF`]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Nid(c_int);

impl Nid {
    pub const UNDEF: Nid = Nid(0);
    pub const COMMONNAME: Nid = Nid(13);
    pub const CRL_NUMBER: Nid = Nid(88);
    pub const AUTHORITY_KEY_IDENTIFIER: Nid = Nid(90);
    pub const X9_62_PRIME256V1: Nid = Nid(415);
    pub const SECP384R1: Nid = Nid(715);

    pub const fn from_raw(raw: c_int) -> Nid {
        Nid(raw)
    }

    pub const fn as_raw(&self) -> c_int {
        self.0
    }

    pub(crate) fn from_oid(oid: &::asn1::ObjectIdentifier) -> Nid {
        const KNOWN: [(::asn1::ObjectIdentifier, Nid); 5] = [
            (::asn1::oid!(2, 5, 4, 3), Nid::COMMONNAME),
            (::asn1::oid!(2, 5, 29, 20), Nid::CRL_NUMBER),
            (::asn1::oid!(2, 5, 29, 35), Nid::AUTHORITY_KEY_IDENTIFIER),
            (::asn1::oid!(1, 2, 840, 10045, 3, 1, 7), Nid::X9_62_PRIME256V1),
            (::asn1::oid!(1, 3, 132, 0, 34), Nid::SECP384R1),
        ];
        KNOWN
            .iter()
            .find(|(known, _)| known == oid)
            .map_or(Nid::UNDEF, |(_, nid)| *nid)
    }

    pub(crate) fn to_oid(self) -> Option<::asn1::ObjectIdentifier> {
        match self {
            Nid::COMMONNAME => Some(::asn1::oid!(2, 5, 4, 3)),
            Nid::CRL_NUMBER => Some(::asn1::oid!(2, 5, 29, 20)),
            Nid::AUTHORITY_KEY_IDENTIFIER => Some(::asn1::oid!(2, 5, 29, 35)),
            _ => None,
        }
    }
}
