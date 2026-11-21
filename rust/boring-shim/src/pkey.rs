use std::marker::PhantomData;
use std::ops::Deref;

use crate::ec::{EcKey, EcKeyRef};
use crate::error::ErrorStack;

/// Marks keys with a public part only
pub enum Public {}

/// Marks keys with a private part; this implementation has no private keys
pub enum Private {}

/// A public key: always an EC P-256 key here
pub struct PKeyRef<T> {
    ec_key: EcKey<T>,
    marker: PhantomData<T>,
}

pub struct PKey<T>(PKeyRef<T>);

impl<T> Clone for PKeyRef<T> {
    fn clone(&self) -> Self {
        Self {
            ec_key: self.ec_key.clone(),
            marker: PhantomData,
        }
    }
}

impl<T> Clone for PKey<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T> PKey<T> {
    pub fn from_ec_key(ec_key: EcKey<T>) -> Result<PKey<T>, ErrorStack> {
        Ok(PKey(PKeyRef {
            ec_key,
            marker: PhantomData,
        }))
    }
}

impl<T> Deref for PKey<T> {
    type Target = PKeyRef<T>;

    fn deref(&self) -> &PKeyRef<T> {
        &self.0
    }
}

impl<T> PKeyRef<T> {
    pub fn ec_key(&self) -> Result<EcKey<T>, ErrorStack> {
        Ok(self.ec_key.clone())
    }

    pub(crate) fn ec_key_ref(&self) -> &EcKeyRef<T> {
        &self.ec_key
    }
}
