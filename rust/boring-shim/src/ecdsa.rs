use std::ops::Deref;

use p256::ecdsa::Signature;
use p256::ecdsa::signature::hazmat::PrehashVerifier;

use crate::bn::BigNum;
use crate::ec::EcKeyRef;
use crate::error::ErrorStack;

const P256_SCALAR_LENGTH: usize = 32;

/// The `(r, s)` pair of an ECDSA signature
#[derive(Clone, Debug)]
pub struct EcdsaSigRef {
    r: BigNum,
    s: BigNum,
}

#[derive(Clone, Debug)]
pub struct EcdsaSig(EcdsaSigRef);

impl EcdsaSig {
    pub fn from_private_components(r: BigNum, s: BigNum) -> Result<EcdsaSig, ErrorStack> {
        Ok(EcdsaSig(EcdsaSigRef { r, s }))
    }
}

impl Deref for EcdsaSig {
    type Target = EcdsaSigRef;

    fn deref(&self) -> &EcdsaSigRef {
        &self.0
    }
}

impl EcdsaSigRef {
    /// Verifies the signature of the digest `data`, as `ECDSA_do_verify` does
    pub fn verify<T>(&self, data: &[u8], eckey: &EcKeyRef<T>) -> Result<bool, ErrorStack> {
        Ok(verify_prehash(eckey, data, &self.r, &self.s))
    }
}

/// `false` for signatures with a scalar out of range, as BoringSSL reports them
pub(crate) fn verify_prehash<T>(key: &EcKeyRef<T>, digest: &[u8], r: &BigNum, s: &BigNum) -> bool {
    let (Some(r), Some(s)) = (r.to_padded::<P256_SCALAR_LENGTH>(), s.to_padded::<P256_SCALAR_LENGTH>()) else {
        return false;
    };
    let Ok(signature) = Signature::from_scalars(r, s) else {
        return false;
    };
    key.verifying_key().verify_prehash(digest, &signature).is_ok()
}
