//! Chain verification with CRLs on certificates and CRLs that OpenSSL generated (`tests/data`): a root, a CA with
//! `pathlen:0`, leaves, a leaf that is no CA but issues a certificate, a leaf with an unknown critical extension, and
//! CRLs of the root and the CA, with and without revocations, one of them expired, a sub-CA below the CA, a chain
//! to another root with the same name, a P-384 CA and a SHA-384 signature (`tests/make-fixtures.sh`).

use boring::asn1::{Asn1Time, Asn1TimeRef};
use boring::bn::BigNum;
use boring::ec::{EcGroup, EcKey};
use boring::ecdsa::EcdsaSig;
use boring::nid::Nid;
use boring::stack::Stack;
use boring::x509::crl::X509CRL;
use boring::x509::store::X509StoreBuilder;
use boring::x509::verify::X509VerifyFlags;
use boring::x509::{X509, X509StoreContext, X509VerifyError, X509VerifyResult};

const DAY_SECONDS: i64 = 24 * 60 * 60;

fn cert(name: &str) -> X509 {
    X509::from_der(&std::fs::read(format!("{}/tests/data/{name}.der", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}

fn crl(name: &str) -> X509CRL {
    X509CRL::from_der(&std::fs::read(format!("{}/tests/data/{name}.der", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}

fn unix(time: &Asn1TimeRef) -> i64 {
    let diff = Asn1Time::from_unix(0).unwrap().diff(time).unwrap();
    i64::from(diff.days) * DAY_SECONDS + i64::from(diff.secs)
}

/// A day after the fixtures were made: the CRLs are current, except the expired one
fn test_time() -> i64 {
    unix(cert("root").not_before()) + DAY_SECONDS
}

/// Verifies `leaf` with `chain` as untrusted certificates, the root and `trusted_crls` in the store, and
/// `untrusted_crls` from the caller, as `attest` does
fn verify(leaf: &str, chain: &[&str], trusted_crls: &[&str], untrusted_crls: &[&str], time: i64) -> X509VerifyResult {
    verify_cert(&cert(leaf), chain, trusted_crls, untrusted_crls, time)
}

fn verify_cert(
    leaf: &X509,
    chain: &[&str],
    trusted_crls: &[&str],
    untrusted_crls: &[&str],
    time: i64,
) -> X509VerifyResult {
    let mut builder = X509StoreBuilder::new().unwrap();
    builder
        .param_mut()
        .set_flags(X509VerifyFlags::CRL_CHECK | X509VerifyFlags::CRL_CHECK_ALL | X509VerifyFlags::X509_STRICT);
    builder.param_mut().set_time(time);
    builder.add_cert(cert("root")).unwrap();
    for name in trusted_crls {
        builder.add_crl(crl(name)).unwrap();
    }
    let store = builder.build();

    let mut untrusted = Stack::new().unwrap();
    for name in chain {
        untrusted.push(cert(name)).unwrap();
    }
    let mut crls = Stack::new().unwrap();
    for name in untrusted_crls {
        crls.push(crl(name)).unwrap();
    }

    let mut context = X509StoreContext::new().unwrap();
    context
        .init(&store, leaf, &untrusted, |c| {
            let is_valid = c.verify_cert_with_crls(crls)?;
            let result = c.verify_result();
            assert_eq!(is_valid, result.is_ok());
            if is_valid {
                let chain: Vec<Vec<u8>> = c.chain().unwrap().iter().map(|cert| cert.to_der().unwrap()).collect();
                assert_eq!(
                    chain[1..],
                    [cert("ca").to_der().unwrap(), cert("root").to_der().unwrap()]
                );
            }
            Ok(result)
        })
        .unwrap()
}

#[test]
fn accepts_a_valid_chain() {
    assert_eq!(
        verify("leaf", &["ca", "root"], &["root_crl"], &["ca_crl"], test_time()),
        Ok(())
    );
    assert_eq!(
        verify("other", &["ca"], &["root_crl", "ca_crl"], &[], test_time()),
        Ok(())
    );
}

#[test]
fn requires_a_crl_for_every_certificate() {
    let time = test_time();
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &[], time),
        Err(X509VerifyError::UNABLE_TO_GET_CRL)
    );
    assert_eq!(
        verify("leaf", &["ca"], &[], &["ca_crl"], time),
        Err(X509VerifyError::UNABLE_TO_GET_CRL)
    );
}

#[test]
fn rejects_revoked_certificates() {
    let time = test_time();
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl_revoked_leaf"], time),
        Err(X509VerifyError::CERT_REVOKED)
    );
    assert_eq!(
        verify("other", &["ca"], &["root_crl", "ca_crl_revoked_leaf"], &[], time),
        Ok(())
    );
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl_revoked_ca"], &["ca_crl"], time),
        Err(X509VerifyError::CERT_REVOKED)
    );
}

#[test]
fn rejects_expired_crls_and_certificates() {
    let time = test_time();
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl_expired"], time),
        Err(X509VerifyError::CRL_HAS_EXPIRED)
    );
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl"], time - 2 * DAY_SECONDS),
        Err(X509VerifyError::CERT_NOT_YET_VALID)
    );
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl"], time + 3700 * DAY_SECONDS),
        Err(X509VerifyError::CERT_HAS_EXPIRED)
    );
}

#[test]
fn rejects_chains_through_non_ca_certificates() {
    let time = test_time();
    assert_eq!(
        verify("fakeleaf", &["fake", "ca"], &["root_crl", "ca_crl"], &[], time),
        Err(X509VerifyError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
    );
}

#[test]
fn rejects_unknown_critical_extensions() {
    let time = test_time();
    assert_eq!(
        verify("critical", &["ca"], &["root_crl", "ca_crl"], &[], time),
        Err(X509VerifyError::UNHANDLED_CRITICAL_EXTENSION)
    );
}

#[test]
fn rejects_chains_without_the_trusted_root() {
    let mut builder = X509StoreBuilder::new().unwrap();
    builder.param_mut().set_time(test_time());
    builder.add_cert(cert("ca")).unwrap();
    let store = builder.build();
    let untrusted = Stack::new().unwrap();
    let mut context = X509StoreContext::new().unwrap();
    let result = context
        .init(&store, &cert("leaf"), &untrusted, |c| {
            c.verify_cert()?;
            Ok(c.verify_result())
        })
        .unwrap();
    // A trusted CA that is not self-signed does not end the chain without partial chain verification
    assert_eq!(result, Err(X509VerifyError::UNABLE_TO_GET_ISSUER_CERT));
}

#[test]
fn checks_issuers_and_signatures() {
    let root = cert("root");
    let ca = cert("ca");
    let leaf = cert("leaf");
    assert_eq!(root.issued(&ca), Ok(()));
    assert_eq!(ca.issued(&leaf), Ok(()));
    assert!(root.issued(&leaf).is_err());
    assert!(ca.verify(&root.public_key().unwrap()).unwrap());
    assert!(!leaf.verify(&root.public_key().unwrap()).unwrap());
    assert!(crl("ca_crl").verify(&ca.public_key().unwrap()).unwrap());
    assert!(!crl("ca_crl").verify(&root.public_key().unwrap()).unwrap());
}

#[test]
fn expires_at_the_end_time() {
    let chain_expiry = ["root", "ca", "leaf"]
        .map(|name| unix(cert(name).not_after()))
        .into_iter()
        .min()
        .unwrap();
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl"], chain_expiry - 1),
        Ok(())
    );
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl"], chain_expiry),
        Err(X509VerifyError::CERT_HAS_EXPIRED)
    );

    let crl_expiry = unix(crl("ca_crl_expired").next_update().unwrap());
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl_expired"], crl_expiry - 1),
        Ok(())
    );
    assert_eq!(
        verify("leaf", &["ca"], &["root_crl"], &["ca_crl_expired"], crl_expiry),
        Err(X509VerifyError::CRL_HAS_EXPIRED)
    );
}

#[test]
fn rejects_tampered_signatures() {
    let mut der = cert("leaf").to_der().unwrap();
    // The last byte belongs to the `s` scalar of the signature
    *der.last_mut().unwrap() ^= 1;
    let tampered = X509::from_der(&der).unwrap();
    assert_eq!(
        verify_cert(&tampered, &["ca"], &["root_crl"], &["ca_crl"], test_time()),
        Err(X509VerifyError::CERT_SIGNATURE_FAILURE)
    );
    assert!(!tampered.verify(&cert("ca").public_key().unwrap()).unwrap());
}

#[test]
fn rejects_unsupported_algorithms_and_curves() {
    let time = test_time();
    // ECDSA with SHA-384
    assert_eq!(
        verify("sha384", &["ca"], &["root_crl", "ca_crl"], &[], time),
        Err(X509VerifyError::CERT_SIGNATURE_FAILURE)
    );
    // A P-384 issuer key
    assert_eq!(
        verify("leaf384", &["ca384"], &["root_crl"], &[], time),
        Err(X509VerifyError::CERT_SIGNATURE_FAILURE)
    );
    assert!(cert("ca384").public_key().is_err());
    assert!(EcGroup::from_curve_name(Nid::SECP384R1).is_err());
}

#[test]
fn rejects_signature_scalars_out_of_range() {
    let key = EcKey::from_public_key_affine_coordinates(
        &EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap(),
        &BigNum::from_slice(&hex("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296")).unwrap(),
        &BigNum::from_slice(&hex("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")).unwrap(),
    )
    .unwrap();
    let digest = [7; 32];
    let order = hex("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
    let one = BigNum::from_slice(&[1]).unwrap();
    for (r, s) in [
        (BigNum::from_slice(&[]).unwrap(), one.clone()),
        (one.clone(), BigNum::from_slice(&[]).unwrap()),
        (BigNum::from_slice(&order).unwrap(), one.clone()),
        (one.clone(), BigNum::from_slice(&order).unwrap()),
        (BigNum::from_slice(&[1; 33]).unwrap(), one.clone()),
    ] {
        let signature = EcdsaSig::from_private_components(r, s).unwrap();
        assert!(!signature.verify(&digest, &key).unwrap());
    }
}

#[test]
fn rejects_chains_to_another_root_with_the_same_name() {
    assert_eq!(
        verify("leaf2", &["ca2", "root2"], &["root_crl"], &[], test_time()),
        Err(X509VerifyError::SELF_SIGNED_CERT_IN_CHAIN)
    );
    assert_eq!(
        verify("leaf2", &["ca2"], &["root_crl"], &[], test_time()),
        Err(X509VerifyError::UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
    );
}

#[test]
fn rejects_exceeded_path_lengths() {
    assert_eq!(
        verify("subleaf", &["sub", "ca"], &["root_crl", "ca_crl"], &[], test_time()),
        Err(X509VerifyError::PATH_LENGTH_EXCEEDED)
    );
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}
