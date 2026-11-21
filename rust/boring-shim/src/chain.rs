//! Certificate chain verification, following BoringSSL `X509_verify_cert` (`crypto/x509/x509_vfy.cc`) for the
//! features attestation uses: chain building from untrusted and trusted certificates, validity times, CA and path
//! length constraints, key usage, signatures, and CRL checks. It fails closed on everything else: critical
//! extensions other than basic constraints and key usage, and signature algorithms other than ECDSA P-256 with
//! SHA-256.

use ::asn1::ObjectIdentifier;
use sha2::{Digest, Sha256};

use crate::bn::BigNum;
use crate::der::{Certificate, Crl, KEY_USAGE_CRL_SIGN, KEY_USAGE_KEY_CERT_SIGN, Signature};
use crate::ec::{EcKey, EcKeyRef};
use crate::ecdsa;
use crate::x509::crl::X509CRL;
use crate::x509::store::X509StoreRef;
use crate::x509::verify::X509VerifyFlags;
use crate::x509::{X509, X509VerifyError, X509VerifyResult};

// BoringSSL's default `X509_VERIFY_PARAM` depth
const MAX_CHAIN_DEPTH: usize = 100;
const HANDLED_CRITICAL_EXTENSIONS: [ObjectIdentifier; 2] = [::asn1::oid!(2, 5, 29, 19), ::asn1::oid!(2, 5, 29, 15)];

/// Builds and verifies the chain of `leaf`, returning the verified chain from the leaf to the trust anchor
pub(crate) fn verify(
    trust: &X509StoreRef,
    leaf: &X509,
    untrusted: &[X509],
    untrusted_crls: &[X509CRL],
) -> (X509VerifyResult, Option<Vec<X509>>) {
    let chain = match build_chain(trust, leaf, untrusted) {
        Ok(chain) => chain,
        Err(err) => return (Err(err), None),
    };
    let result = trust
        .param
        .time
        .ok_or(X509VerifyError::UNSPECIFIED)
        .and_then(|time| check_chain(trust, &chain, untrusted_crls, time));
    (result, Some(chain))
}

/// Checks that `issuer` could have issued `subject` by names, key identifiers and key usage (`X509_check_issued`)
pub(crate) fn check_issued(issuer: &Certificate, subject: &Certificate) -> X509VerifyResult {
    if issuer.subject != subject.issuer {
        return Err(X509VerifyError::SUBJECT_ISSUER_MISMATCH);
    }
    if let (Some(authority_key_id), Some(subject_key_id)) = (&subject.authority_key_id, &issuer.subject_key_id)
        && authority_key_id != subject_key_id
    {
        return Err(X509VerifyError::AKID_SKID_MISMATCH);
    }
    if !issuer.has_key_usage(KEY_USAGE_KEY_CERT_SIGN) {
        return Err(X509VerifyError::KEYUSAGE_NO_CERTSIGN);
    }
    Ok(())
}

/// Verifies an ECDSA P-256 SHA-256 signature; `None` stands for an unsupported algorithm
pub(crate) fn verify_signature<T>(signature: Option<&Signature>, key: &EcKeyRef<T>) -> bool {
    let Some(signature) = signature else {
        return false;
    };
    let (Ok(r), Ok(s)) = (BigNum::from_slice(&signature.r), BigNum::from_slice(&signature.s)) else {
        return false;
    };
    let digest = Sha256::digest(&signature.signed_data);
    ecdsa::verify_prehash(key, &digest, &r, &s)
}

/// Follows issuers from `leaf`, preferring trusted certificates, until a trusted self-issued certificate
fn build_chain(trust: &X509StoreRef, leaf: &X509, untrusted: &[X509]) -> Result<Vec<X509>, X509VerifyError> {
    let is_trusted = |cert: &X509| trust.certs.iter().any(|trusted| trusted.cert.der == cert.cert.der);
    let mut chain = vec![leaf.clone()];
    loop {
        let current = chain.last().expect("chain is never empty");
        if is_trusted(current) {
            if !current.cert.is_self_issued() {
                return Err(X509VerifyError::UNABLE_TO_GET_ISSUER_CERT);
            }
            return Ok(chain);
        }
        if current.cert.is_self_issued() {
            return Err(if chain.len() == 1 {
                X509VerifyError::DEPTH_ZERO_SELF_SIGNED_CERT
            } else {
                X509VerifyError::SELF_SIGNED_CERT_IN_CHAIN
            });
        }
        if chain.len() > MAX_CHAIN_DEPTH {
            return Err(X509VerifyError::CERT_CHAIN_TOO_LONG);
        }
        let is_issuer = |candidate: &&X509| {
            check_issued(&candidate.cert, &current.cert).is_ok()
                && !chain.iter().any(|cert| cert.cert.der == candidate.cert.der)
        };
        let issuer = trust
            .certs
            .iter()
            .find(is_issuer)
            .or_else(|| untrusted.iter().find(is_issuer))
            .ok_or(X509VerifyError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY)?
            .clone();
        chain.push(issuer);
    }
}

fn check_chain(trust: &X509StoreRef, chain: &[X509], untrusted_crls: &[X509CRL], time: i64) -> X509VerifyResult {
    for (depth, cert) in chain.iter().enumerate() {
        let cert = &cert.cert;
        if cert
            .extensions
            .iter()
            .any(|extension| extension.is_critical && !HANDLED_CRITICAL_EXTENSIONS.contains(&extension.oid))
        {
            return Err(X509VerifyError::UNHANDLED_CRITICAL_EXTENSION);
        }
        if cert.not_before > time {
            return Err(X509VerifyError::CERT_NOT_YET_VALID);
        }
        // A certificate expires at its `notAfter` time, as in BoringSSL `X509_cmp_time_posix`
        if cert.not_after <= time {
            return Err(X509VerifyError::CERT_HAS_EXPIRED);
        }
        if depth > 0 {
            check_ca(cert, depth)?;
        }
    }

    // The trust anchor's self-signature is not checked, as in BoringSSL
    for pair in chain.windows(2) {
        let issuer_key = public_key(&pair[1].cert).ok_or(X509VerifyError::CERT_SIGNATURE_FAILURE)?;
        if !verify_signature(pair[0].cert.signature.as_ref(), &issuer_key) {
            return Err(X509VerifyError::CERT_SIGNATURE_FAILURE);
        }
    }

    let flags = trust.param.flags;
    if !flags.contains(X509VerifyFlags::CRL_CHECK) {
        return Ok(());
    }
    let checked_depth = if flags.contains(X509VerifyFlags::CRL_CHECK_ALL) {
        chain.len()
    } else {
        1
    };
    let crls: Vec<&Crl> = trust.crls.iter().chain(untrusted_crls).map(|crl| &crl.crl).collect();
    for depth in 0..checked_depth {
        // A self-signed trust anchor issues its own CRL
        let issuer = chain.get(depth + 1).unwrap_or(&chain[depth]);
        check_revocation(&chain[depth].cert, &issuer.cert, &crls, time)?;
    }
    Ok(())
}

/// Checks a certificate at `depth` above the leaf that issues others (`check_chain_extensions`)
fn check_ca(cert: &Certificate, depth: usize) -> X509VerifyResult {
    let constraints = cert
        .basic_constraints
        .as_ref()
        .filter(|c| c.is_ca)
        .ok_or(X509VerifyError::INVALID_CA)?;
    if !cert.has_key_usage(KEY_USAGE_KEY_CERT_SIGN) {
        return Err(X509VerifyError::KEYUSAGE_NO_CERTSIGN);
    }
    // The number of intermediate CA certificates below this one
    let intermediates = depth - 1;
    if constraints.path_length.is_some_and(|max| intermediates as u64 > max) {
        return Err(X509VerifyError::PATH_LENGTH_EXCEEDED);
    }
    Ok(())
}

/// Requires a valid CRL from `issuer` for `cert` and checks that none lists it (`check_cert`, `check_crl`)
fn check_revocation(cert: &Certificate, issuer: &Certificate, crls: &[&Crl], time: i64) -> X509VerifyResult {
    let candidates: Vec<&&Crl> = crls.iter().filter(|crl| crl.issuer == cert.issuer).collect();
    if candidates.is_empty() {
        return Err(X509VerifyError::UNABLE_TO_GET_CRL);
    }
    let issuer_key = public_key(issuer).ok_or(X509VerifyError::CRL_SIGNATURE_FAILURE)?;
    for crl in candidates {
        if !issuer.has_key_usage(KEY_USAGE_CRL_SIGN) {
            return Err(X509VerifyError::KEYUSAGE_NO_CRL_SIGN);
        }
        if !verify_signature(crl.signature.as_ref(), &issuer_key) {
            return Err(X509VerifyError::CRL_SIGNATURE_FAILURE);
        }
        if crl.this_update > time {
            return Err(X509VerifyError::CRL_NOT_YET_VALID);
        }
        if crl.next_update.is_some_and(|next_update| next_update <= time) {
            return Err(X509VerifyError::CRL_HAS_EXPIRED);
        }
        // Delta CRLs, distribution point scopes and indirect CRLs are not supported
        let has_critical_extension = crl.extensions.iter().any(|extension| extension.is_critical)
            || crl.revoked.iter().any(|entry| entry.has_critical_extension);
        if has_critical_extension {
            return Err(X509VerifyError::UNHANDLED_CRITICAL_CRL_EXTENSION);
        }
        if crl.revoked.iter().any(|entry| entry.serial == cert.serial) {
            return Err(X509VerifyError::CERT_REVOKED);
        }
    }
    Ok(())
}

fn public_key(cert: &Certificate) -> Option<EcKey<crate::pkey::Public>> {
    EcKey::from_sec1(cert.public_key.as_deref()?).ok()
}
