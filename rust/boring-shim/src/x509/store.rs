use std::ops::Deref;

use crate::error::ErrorStack;
use crate::x509::crl::X509CRL;
use crate::x509::verify::X509VerifyParamRef;
use crate::x509::{X509, X509Ref};

/// Trusted certificates and CRLs with the verification parameters
#[derive(Clone, Debug, Default)]
pub struct X509StoreRef {
    pub(crate) certs: Vec<X509>,
    pub(crate) crls: Vec<X509CRL>,
    pub(crate) param: X509VerifyParamRef,
}

#[derive(Clone, Debug)]
pub struct X509Store(X509StoreRef);

impl Deref for X509Store {
    type Target = X509StoreRef;

    fn deref(&self) -> &X509StoreRef {
        &self.0
    }
}

pub struct X509StoreBuilder(X509StoreRef);

impl X509StoreBuilder {
    pub fn new() -> Result<X509StoreBuilder, ErrorStack> {
        Ok(X509StoreBuilder(X509StoreRef::default()))
    }

    pub fn build(self) -> X509Store {
        X509Store(self.0)
    }

    pub fn add_cert(&mut self, cert: impl AsRef<X509Ref>) -> Result<(), ErrorStack> {
        self.0.certs.push(cert.as_ref().to_owned());
        Ok(())
    }

    pub fn add_crl(&mut self, crl: X509CRL) -> Result<(), ErrorStack> {
        self.0.crls.push(crl);
        Ok(())
    }

    pub fn param_mut(&mut self) -> &mut X509VerifyParamRef {
        &mut self.0.param
    }
}
