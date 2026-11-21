use std::borrow::Borrow;
use std::fmt;
use std::ops::Deref;

use crate::asn1::{Asn1ObjectRef, Asn1StringRef, Asn1TimeRef};
use crate::chain;
use crate::der::{self, Certificate};
use crate::ec::EcKey;
use crate::error::ErrorStack;
use crate::nid::Nid;
use crate::pkey::{PKey, PKeyRef, Public};
use crate::stack::{Stack, StackRef, Stackable};

pub mod crl;
pub mod store;
pub mod verify;

/// An X.509 certificate; not `Clone`, so that `to_owned` returns an [`X509`] as in `boring`
#[derive(Debug)]
pub struct X509Ref {
    pub(crate) cert: Certificate,
    not_before: Asn1TimeRef,
    not_after: Asn1TimeRef,
    subject_name: X509NameRef,
    extensions: Stack<X509Extension>,
}

#[derive(Debug)]
pub struct X509(X509Ref);

impl Clone for X509 {
    fn clone(&self) -> X509 {
        self.0.to_owned()
    }
}

impl Stackable for X509 {}

impl X509 {
    pub fn from_der(der: &[u8]) -> Result<X509, ErrorStack> {
        let cert = der::parse_certificate(der)?;
        let subject_name = X509NameRef {
            entries: cert
                .subject_entries
                .iter()
                .map(|entry| X509NameEntryRef {
                    object: Asn1ObjectRef::new(entry.oid.clone()),
                    data: Asn1StringRef::new(entry.tag, entry.data.clone()),
                })
                .collect(),
        };
        let extensions = Stack::from_vec(cert.extensions.iter().map(X509Extension::new).collect());
        Ok(X509(X509Ref {
            not_before: Asn1TimeRef::from_unix_seconds(cert.not_before),
            not_after: Asn1TimeRef::from_unix_seconds(cert.not_after),
            subject_name,
            extensions,
            cert,
        }))
    }

    /// Parses the first certificate of PEM data
    pub fn from_pem(pem: &[u8]) -> Result<X509, ErrorStack> {
        let ders = der::parse_pem_certificates(pem)?;
        let der = ders.first().ok_or_else(|| ErrorStack::new("no certificate in PEM"))?;
        X509::from_der(der)
    }

    pub fn stack_from_pem(pem: &[u8]) -> Result<Vec<X509>, ErrorStack> {
        der::parse_pem_certificates(pem)?
            .iter()
            .map(|der| X509::from_der(der))
            .collect()
    }
}

const OCTET_STRING_TAG: u32 = 4;

impl Deref for X509 {
    type Target = X509Ref;

    fn deref(&self) -> &X509Ref {
        &self.0
    }
}

impl AsRef<X509Ref> for X509 {
    fn as_ref(&self) -> &X509Ref {
        &self.0
    }
}

impl AsRef<X509Ref> for X509Ref {
    fn as_ref(&self) -> &X509Ref {
        self
    }
}

impl Borrow<X509Ref> for X509 {
    fn borrow(&self) -> &X509Ref {
        &self.0
    }
}

impl ToOwned for X509Ref {
    type Owned = X509;

    fn to_owned(&self) -> X509 {
        X509(X509Ref {
            cert: self.cert.clone(),
            not_before: self.not_before.clone(),
            not_after: self.not_after.clone(),
            subject_name: self.subject_name.clone(),
            extensions: self.extensions.clone(),
        })
    }
}

impl X509Ref {
    pub fn to_der(&self) -> Result<Vec<u8>, ErrorStack> {
        Ok(self.cert.der.clone())
    }

    pub fn subject_name(&self) -> &X509NameRef {
        &self.subject_name
    }

    pub fn public_key(&self) -> Result<PKey<Public>, ErrorStack> {
        let sec1 = self
            .cert
            .public_key
            .as_deref()
            .ok_or_else(|| ErrorStack::new("unsupported public key type"))?;
        PKey::from_ec_key(EcKey::from_sec1(sec1)?)
    }

    pub fn not_before(&self) -> &Asn1TimeRef {
        &self.not_before
    }

    pub fn not_after(&self) -> &Asn1TimeRef {
        &self.not_after
    }

    /// Checks whether `self` could have issued `subject`, without checking the signature (`X509_check_issued`)
    pub fn issued(&self, subject: &X509Ref) -> X509VerifyResult {
        chain::check_issued(&self.cert, &subject.cert)
    }

    /// Checks the certificate signature with `key`
    pub fn verify<T>(&self, key: &PKeyRef<T>) -> Result<bool, ErrorStack> {
        Ok(chain::verify_signature(self.cert.signature.as_ref(), key.ec_key_ref()))
    }

    pub fn extensions(&self) -> Option<&StackRef<X509Extension>> {
        (!self.extensions.is_empty()).then_some(&self.extensions)
    }
}

#[derive(Clone, Debug)]
pub struct X509NameRef {
    entries: Vec<X509NameEntryRef>,
}

impl X509NameRef {
    pub fn entries_by_nid(&self, nid: Nid) -> impl Iterator<Item = &X509NameEntryRef> {
        let oid = nid.to_oid();
        self.entries
            .iter()
            .filter(move |entry| oid.as_ref().is_some_and(|oid| entry.object.oid() == oid))
    }
}

#[derive(Clone, Debug)]
pub struct X509NameEntryRef {
    object: Asn1ObjectRef,
    data: Asn1StringRef,
}

impl X509NameEntryRef {
    pub fn data(&self) -> &Asn1StringRef {
        &self.data
    }

    pub fn object(&self) -> &Asn1ObjectRef {
        &self.object
    }
}

/// A certificate or CRL extension; `data` holds the OCTET STRING contents
#[derive(Clone, Debug)]
pub struct X509Extension {
    object: Asn1ObjectRef,
    data: Asn1StringRef,
}

impl Stackable for X509Extension {}

impl X509Extension {
    pub(crate) fn new(extension: &der::Extension) -> X509Extension {
        X509Extension {
            object: Asn1ObjectRef::new(extension.oid.clone()),
            data: Asn1StringRef::new(::asn1::Tag::primitive(OCTET_STRING_TAG), extension.value.clone()),
        }
    }

    pub fn object(&self) -> &Asn1ObjectRef {
        &self.object
    }

    pub fn data(&self) -> &Asn1StringRef {
        &self.data
    }
}

/// A verification failure with BoringSSL's `X509_V_ERR_*` code
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct X509VerifyError(i32);

pub type X509VerifyResult = Result<(), X509VerifyError>;

impl X509VerifyError {
    pub const UNSPECIFIED: X509VerifyError = X509VerifyError(1);
    pub const UNABLE_TO_GET_ISSUER_CERT: X509VerifyError = X509VerifyError(2);
    pub const UNABLE_TO_GET_CRL: X509VerifyError = X509VerifyError(3);
    pub const CERT_SIGNATURE_FAILURE: X509VerifyError = X509VerifyError(7);
    pub const CRL_SIGNATURE_FAILURE: X509VerifyError = X509VerifyError(8);
    pub const CERT_NOT_YET_VALID: X509VerifyError = X509VerifyError(9);
    pub const CERT_HAS_EXPIRED: X509VerifyError = X509VerifyError(10);
    pub const CRL_NOT_YET_VALID: X509VerifyError = X509VerifyError(11);
    pub const CRL_HAS_EXPIRED: X509VerifyError = X509VerifyError(12);
    pub const DEPTH_ZERO_SELF_SIGNED_CERT: X509VerifyError = X509VerifyError(18);
    pub const SELF_SIGNED_CERT_IN_CHAIN: X509VerifyError = X509VerifyError(19);
    pub const UNABLE_TO_GET_ISSUER_CERT_LOCALLY: X509VerifyError = X509VerifyError(20);
    pub const CERT_CHAIN_TOO_LONG: X509VerifyError = X509VerifyError(22);
    pub const CERT_REVOKED: X509VerifyError = X509VerifyError(23);
    pub const INVALID_CA: X509VerifyError = X509VerifyError(24);
    pub const PATH_LENGTH_EXCEEDED: X509VerifyError = X509VerifyError(25);
    pub const SUBJECT_ISSUER_MISMATCH: X509VerifyError = X509VerifyError(29);
    pub const AKID_SKID_MISMATCH: X509VerifyError = X509VerifyError(30);
    pub const KEYUSAGE_NO_CERTSIGN: X509VerifyError = X509VerifyError(32);
    pub const UNHANDLED_CRITICAL_EXTENSION: X509VerifyError = X509VerifyError(34);
    pub const KEYUSAGE_NO_CRL_SIGN: X509VerifyError = X509VerifyError(35);
    pub const UNHANDLED_CRITICAL_CRL_EXTENSION: X509VerifyError = X509VerifyError(36);

    pub fn as_raw(&self) -> i32 {
        self.0
    }

    fn name(&self) -> &'static str {
        match *self {
            Self::UNABLE_TO_GET_ISSUER_CERT => "unable to get issuer certificate",
            Self::UNABLE_TO_GET_CRL => "unable to get certificate CRL",
            Self::CERT_SIGNATURE_FAILURE => "certificate signature failure",
            Self::CRL_SIGNATURE_FAILURE => "CRL signature failure",
            Self::CERT_NOT_YET_VALID => "certificate is not yet valid",
            Self::CERT_HAS_EXPIRED => "certificate has expired",
            Self::CRL_NOT_YET_VALID => "CRL is not yet valid",
            Self::CRL_HAS_EXPIRED => "CRL has expired",
            Self::DEPTH_ZERO_SELF_SIGNED_CERT => "self signed certificate",
            Self::SELF_SIGNED_CERT_IN_CHAIN => "self signed certificate in certificate chain",
            Self::UNABLE_TO_GET_ISSUER_CERT_LOCALLY => "unable to get local issuer certificate",
            Self::CERT_CHAIN_TOO_LONG => "certificate chain too long",
            Self::CERT_REVOKED => "certificate revoked",
            Self::INVALID_CA => "invalid CA certificate",
            Self::PATH_LENGTH_EXCEEDED => "path length constraint exceeded",
            Self::SUBJECT_ISSUER_MISMATCH => "subject issuer mismatch",
            Self::AKID_SKID_MISMATCH => "authority and subject key identifier mismatch",
            Self::KEYUSAGE_NO_CERTSIGN => "key usage does not include certificate signing",
            Self::UNHANDLED_CRITICAL_EXTENSION => "unhandled critical extension",
            Self::KEYUSAGE_NO_CRL_SIGN => "key usage does not include CRL signing",
            Self::UNHANDLED_CRITICAL_CRL_EXTENSION => "unhandled critical CRL extension",
            _ => "unspecified certificate verification error",
        }
    }
}

impl fmt::Debug for X509VerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("X509VerifyError")
            .field("code", &self.0)
            .field("error", &self.name())
            .finish()
    }
}

impl fmt::Display for X509VerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl std::error::Error for X509VerifyError {}

/// Verification state, as `X509_STORE_CTX`
pub struct X509StoreContextRef {
    state: Option<ContextState>,
    result: X509VerifyResult,
    chain: Option<Stack<X509>>,
}

struct ContextState {
    trust: store::X509StoreRef,
    cert: X509,
    untrusted: Vec<X509>,
}

pub struct X509StoreContext(X509StoreContextRef);

impl X509StoreContext {
    pub fn new() -> Result<X509StoreContext, ErrorStack> {
        Ok(X509StoreContext(X509StoreContextRef {
            state: None,
            result: Err(X509VerifyError::UNSPECIFIED),
            chain: None,
        }))
    }

    pub fn init<F, T>(
        &mut self,
        trust: &store::X509StoreRef,
        cert: &X509Ref,
        cert_chain: &StackRef<X509>,
        with_context: F,
    ) -> Result<T, ErrorStack>
    where
        F: FnOnce(&mut X509StoreContextRef) -> Result<T, ErrorStack>,
    {
        let context = &mut self.0;
        context.state = Some(ContextState {
            trust: trust.clone(),
            cert: cert.to_owned(),
            untrusted: cert_chain.as_slice().to_vec(),
        });
        let result = with_context(context);
        context.state = None;
        result
    }
}

impl X509StoreContextRef {
    pub fn verify_cert(&mut self) -> Result<bool, ErrorStack> {
        self.verify_with_crls(&[])
    }

    pub fn verify_cert_with_crls(&mut self, untrusted_crls: Stack<crl::X509CRL>) -> Result<bool, ErrorStack> {
        self.verify_with_crls(untrusted_crls.as_slice())
    }

    pub fn verify_result(&self) -> X509VerifyResult {
        self.result
    }

    pub fn chain(&self) -> Option<&StackRef<X509>> {
        self.chain.as_deref()
    }

    fn verify_with_crls(&mut self, untrusted_crls: &[crl::X509CRL]) -> Result<bool, ErrorStack> {
        let state = self
            .state
            .as_ref()
            .ok_or_else(|| ErrorStack::new("context is not initialized"))?;
        let (result, chain) = chain::verify(&state.trust, &state.cert, &state.untrusted, untrusted_crls);
        self.result = result;
        self.chain = chain.map(Stack::from_vec);
        Ok(result.is_ok())
    }
}
