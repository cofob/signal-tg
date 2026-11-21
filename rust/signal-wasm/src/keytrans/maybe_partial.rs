//
// Copyright 2026 Signal Messenger, LLC.
// SPDX-License-Identifier: AGPL-3.0-only
//

use std::collections::BTreeSet;
use std::fmt;

/// A tag identifying an optional field in [`libsignal_keytrans::AccountData`]
///
/// The values match `AccountDataField` in `KeyTransparency.ts` of the Node package.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum AccountDataField {
    E164 = 0,
    UsernameHash = 1,
}

impl TryFrom<u8> for AccountDataField {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, u8> {
        match value {
            0 => Ok(Self::E164),
            1 => Ok(Self::UsernameHash),
            other => Err(other),
        }
    }
}

impl fmt::Display for AccountDataField {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::E164 => "E.164",
            Self::UsernameHash => "Username hash",
        })
    }
}

/// This struct adds to its type parameter a (potentially empty) list of
/// account fields (see [`AccountDataField`]) that can no longer be verified
/// by the server.
///
/// Basically it is a non-generic version of a `Writer` monad with [`BTreeSet`] used
/// to accumulate missing field entries in some order while avoiding duplicates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaybePartial<T> {
    pub inner: T,
    pub missing_fields: BTreeSet<AccountDataField>,
}

impl<T> From<T> for MaybePartial<T> {
    fn from(value: T) -> Self {
        Self {
            inner: value,
            missing_fields: Default::default(),
        }
    }
}

impl<T> MaybePartial<T> {
    pub(crate) fn new_complete(inner: T) -> Self {
        Self {
            inner,
            missing_fields: Default::default(),
        }
    }

    pub(crate) fn new(
        inner: T,
        missing_fields: impl IntoIterator<Item = AccountDataField>,
    ) -> Self {
        Self {
            inner,
            missing_fields: BTreeSet::from_iter(missing_fields),
        }
    }

    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> MaybePartial<U> {
        MaybePartial {
            inner: f(self.inner),
            missing_fields: self.missing_fields,
        }
    }

    pub fn and_then<U>(self, f: impl FnOnce(T) -> MaybePartial<U>) -> MaybePartial<U> {
        let MaybePartial {
            inner,
            mut missing_fields,
        } = self;
        let MaybePartial {
            inner: final_inner,
            missing_fields: other_missing,
        } = f(inner);
        missing_fields.extend(other_missing);
        MaybePartial {
            inner: final_inner,
            missing_fields,
        }
    }

    pub fn into_result(self) -> Result<T, BTreeSet<AccountDataField>> {
        let Self {
            inner,
            missing_fields,
        } = self;
        if missing_fields.is_empty() {
            Ok(inner)
        } else {
            Err(missing_fields)
        }
    }
}

impl<T, E> MaybePartial<Result<T, E>> {
    pub fn transpose(self) -> Result<MaybePartial<T>, E> {
        let MaybePartial {
            inner,
            missing_fields,
        } = self;
        Ok(MaybePartial {
            inner: inner?,
            missing_fields,
        })
    }
}
