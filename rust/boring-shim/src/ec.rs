use std::marker::PhantomData;
use std::ops::Deref;

use p256::ecdsa::VerifyingKey;

use crate::bn::{BigNumContext, BigNumRef};
use crate::error::ErrorStack;
use crate::nid::Nid;
use crate::pkey::Public;

const P256_COORDINATE_LENGTH: usize = 32;
const SEC1_UNCOMPRESSED_TAG: u8 = 0x04;

/// An elliptic curve: only P-256 is supported
#[derive(Clone, Debug)]
pub struct EcGroupRef(());

#[derive(Clone, Debug)]
pub struct EcGroup(EcGroupRef);

impl EcGroup {
    pub fn from_curve_name(nid: Nid) -> Result<EcGroup, ErrorStack> {
        if nid != Nid::X9_62_PRIME256V1 {
            return Err(ErrorStack::new("unsupported curve"));
        }
        Ok(EcGroup(EcGroupRef(())))
    }
}

impl Deref for EcGroup {
    type Target = EcGroupRef;

    fn deref(&self) -> &EcGroupRef {
        &self.0
    }
}

/// A validated P-256 point
#[derive(Clone, Debug)]
pub struct EcPointRef {
    key: VerifyingKey,
}

#[derive(Clone, Debug)]
pub struct EcPoint(EcPointRef);

impl EcPoint {
    pub fn from_bytes(_group: &EcGroupRef, buf: &[u8], _ctx: &mut BigNumContext) -> Result<EcPoint, ErrorStack> {
        Ok(EcPoint(EcPointRef { key: parse_sec1(buf)? }))
    }
}

impl Deref for EcPoint {
    type Target = EcPointRef;

    fn deref(&self) -> &EcPointRef {
        &self.0
    }
}

/// A P-256 public key
pub struct EcKeyRef<T> {
    key: VerifyingKey,
    marker: PhantomData<T>,
}

pub struct EcKey<T>(EcKeyRef<T>);

impl<T> Clone for EcKey<T> {
    fn clone(&self) -> Self {
        EcKey(EcKeyRef {
            key: self.0.key,
            marker: PhantomData,
        })
    }
}

impl<T> Deref for EcKey<T> {
    type Target = EcKeyRef<T>;

    fn deref(&self) -> &EcKeyRef<T> {
        &self.0
    }
}

impl<T> EcKeyRef<T> {
    pub(crate) fn verifying_key(&self) -> &VerifyingKey {
        &self.key
    }
}

impl EcKey<Public> {
    pub fn from_public_key(_group: &EcGroupRef, public_key: &EcPointRef) -> Result<EcKey<Public>, ErrorStack> {
        Ok(Self::from_verifying_key(public_key.key))
    }

    pub fn from_public_key_affine_coordinates(
        _group: &EcGroupRef,
        x: &BigNumRef,
        y: &BigNumRef,
    ) -> Result<EcKey<Public>, ErrorStack> {
        let invalid = || ErrorStack::new("invalid point coordinates");
        let x = x.to_padded::<P256_COORDINATE_LENGTH>().ok_or_else(invalid)?;
        let y = y.to_padded::<P256_COORDINATE_LENGTH>().ok_or_else(invalid)?;
        let mut sec1 = Vec::with_capacity(1 + 2 * P256_COORDINATE_LENGTH);
        sec1.push(SEC1_UNCOMPRESSED_TAG);
        sec1.extend_from_slice(&x);
        sec1.extend_from_slice(&y);
        Ok(Self::from_verifying_key(parse_sec1(&sec1)?))
    }

    pub(crate) fn from_sec1(bytes: &[u8]) -> Result<EcKey<Public>, ErrorStack> {
        Ok(Self::from_verifying_key(parse_sec1(bytes)?))
    }

    fn from_verifying_key(key: VerifyingKey) -> EcKey<Public> {
        EcKey(EcKeyRef {
            key,
            marker: PhantomData,
        })
    }
}

/// Parses a SEC1 point, rejecting the identity and points off the curve
fn parse_sec1(bytes: &[u8]) -> Result<VerifyingKey, ErrorStack> {
    VerifyingKey::from_sec1_bytes(bytes).map_err(|_| ErrorStack::new("invalid P-256 point"))
}
