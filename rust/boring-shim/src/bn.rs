use std::ops::Deref;

use crate::error::ErrorStack;

/// A non-negative integer as big-endian bytes without leading zeros
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BigNumRef {
    bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BigNum(BigNumRef);

impl BigNum {
    pub fn from_slice(n: &[u8]) -> Result<BigNum, ErrorStack> {
        let start = n.iter().position(|&b| b != 0).unwrap_or(n.len());
        Ok(BigNum(BigNumRef {
            bytes: n[start..].to_vec(),
        }))
    }
}

impl Deref for BigNum {
    type Target = BigNumRef;

    fn deref(&self) -> &BigNumRef {
        &self.0
    }
}

impl BigNumRef {
    /// Left-pads the value to `N` bytes; `None` when it does not fit
    pub(crate) fn to_padded<const N: usize>(&self) -> Option<[u8; N]> {
        let mut out = [0; N];
        let offset = N.checked_sub(self.bytes.len())?;
        out[offset..].copy_from_slice(&self.bytes);
        Some(out)
    }
}

/// Scratch space of BoringSSL big number operations, which this implementation does not need
pub struct BigNumContext(());

impl BigNumContext {
    pub fn new() -> Result<BigNumContext, ErrorStack> {
        Ok(BigNumContext(()))
    }
}
