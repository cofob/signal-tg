use std::ops::BitOr;

/// Verification flags with BoringSSL's `X509_V_FLAG_*` values
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub struct X509VerifyFlags(u64);

impl X509VerifyFlags {
    pub const CRL_CHECK: X509VerifyFlags = X509VerifyFlags(0x4);
    pub const CRL_CHECK_ALL: X509VerifyFlags = X509VerifyFlags(0x8);
    pub const X509_STRICT: X509VerifyFlags = X509VerifyFlags(0x20);

    pub fn contains(&self, other: X509VerifyFlags) -> bool {
        self.0 & other.0 == other.0
    }
}

impl BitOr for X509VerifyFlags {
    type Output = X509VerifyFlags;

    fn bitor(self, rhs: X509VerifyFlags) -> X509VerifyFlags {
        X509VerifyFlags(self.0 | rhs.0)
    }
}

/// Verification parameters: flags and the time to verify at
#[derive(Clone, Debug, Default)]
pub struct X509VerifyParamRef {
    pub(crate) flags: X509VerifyFlags,
    // Seconds since the Unix epoch; verification fails without it, since wasm32 has no clock to default to
    pub(crate) time: Option<i64>,
}

impl X509VerifyParamRef {
    pub fn set_flags(&mut self, flags: X509VerifyFlags) {
        self.flags = self.flags | flags;
    }

    pub fn set_time(&mut self, time: i64) {
        self.time = Some(time);
    }
}
