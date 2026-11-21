use std::ops::Deref;

use crate::asn1::Asn1TimeRef;
use crate::chain;
use crate::der::{self, Crl};
use crate::error::ErrorStack;
use crate::pkey::PKeyRef;
use crate::stack::{Stack, StackRef, Stackable};
use crate::x509::X509Extension;

/// A certificate revocation list; not `Clone`, so that `to_owned` returns an [`X509CRL`] as in `boring`
#[derive(Debug)]
pub struct X509CRLRef {
    pub(crate) crl: Crl,
    last_update: Asn1TimeRef,
    next_update: Option<Asn1TimeRef>,
    extensions: Stack<X509Extension>,
}

#[derive(Debug)]
pub struct X509CRL(X509CRLRef);

impl Clone for X509CRL {
    fn clone(&self) -> X509CRL {
        self.0.to_owned()
    }
}

impl Stackable for X509CRL {}

impl X509CRL {
    pub fn from_der(der: &[u8]) -> Result<X509CRL, ErrorStack> {
        let crl = der::parse_crl(der)?;
        Ok(X509CRL(X509CRLRef {
            last_update: Asn1TimeRef::from_unix_seconds(crl.this_update),
            next_update: crl.next_update.map(Asn1TimeRef::from_unix_seconds),
            extensions: Stack::from_vec(crl.extensions.iter().map(X509Extension::new).collect()),
            crl,
        }))
    }
}

impl Deref for X509CRL {
    type Target = X509CRLRef;

    fn deref(&self) -> &X509CRLRef {
        &self.0
    }
}

impl AsRef<X509CRLRef> for X509CRL {
    fn as_ref(&self) -> &X509CRLRef {
        &self.0
    }
}

impl std::borrow::Borrow<X509CRLRef> for X509CRL {
    fn borrow(&self) -> &X509CRLRef {
        &self.0
    }
}

impl ToOwned for X509CRLRef {
    type Owned = X509CRL;

    fn to_owned(&self) -> X509CRL {
        X509CRL(X509CRLRef {
            crl: self.crl.clone(),
            last_update: self.last_update.clone(),
            next_update: self.next_update.clone(),
            extensions: self.extensions.clone(),
        })
    }
}

impl X509CRLRef {
    pub fn last_update(&self) -> Option<&Asn1TimeRef> {
        Some(&self.last_update)
    }

    pub fn next_update(&self) -> Option<&Asn1TimeRef> {
        self.next_update.as_ref()
    }

    pub fn extensions(&self) -> Option<&StackRef<X509Extension>> {
        (!self.extensions.is_empty()).then_some(&self.extensions)
    }

    /// Checks the CRL signature with `key`
    pub fn verify<T>(&self, key: &PKeyRef<T>) -> Result<bool, ErrorStack> {
        Ok(chain::verify_signature(self.crl.signature.as_ref(), key.ec_key_ref()))
    }

    pub fn to_der(&self) -> Result<Vec<u8>, ErrorStack> {
        Ok(self.crl.der.clone())
    }
}
