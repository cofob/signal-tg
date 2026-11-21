#!/usr/bin/env bash
# Generates the certificate and CRL fixtures of `chain.rs`: `tests/make-fixtures.sh tests/data`
set -euo pipefail
OUT="$(cd "$1" && pwd)"
WORK="$(mktemp -d)"
cd "$WORK"

cat > ca.cnf <<'EOF'
[ca]
default_ca = ca_default
[ca_default]
database = index.txt
crlnumber = crlnumber
default_md = sha256
default_crl_days = 3650
crl_extensions = crl_ext
[crl_ext]
authorityKeyIdentifier = keyid:always
[root_ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[ca_ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[leaf_ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[critical_ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
1.2.3.4 = critical, DER:05:00
EOF

key() { openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"; }
sign() { # name subject issuer ext serial
  openssl req -new -key "$1.key" -subj "/CN=$2" -out "$1.csr"
  openssl x509 -req -in "$1.csr" -CA "$3.pem" -CAkey "$3.key" -set_serial "$5" -days 3650 \
    -extfile ca.cnf -extensions "$4" -sha256 -out "$1.pem" 2>/dev/null
}
crl() { # issuer out [revoked-cert] [crlhours]
  rm -f index.txt index.txt.attr; touch index.txt; echo 01 > crlnumber
  if [ -n "${3:-}" ]; then openssl ca -config ca.cnf -keyfile "$1.key" -cert "$1.pem" -revoke "$3.pem" 2>/dev/null; fi
  if [ -n "${4:-}" ]; then
    openssl ca -config ca.cnf -keyfile "$1.key" -cert "$1.pem" -gencrl -crlhours "$4" -out "$2.pem" 2>/dev/null
  else
    openssl ca -config ca.cnf -keyfile "$1.key" -cert "$1.pem" -gencrl -out "$2.pem" 2>/dev/null
  fi
  openssl crl -in "$2.pem" -outform DER -out "$OUT/$2.der"
}

key root
openssl req -x509 -new -key root.key -subj "/CN=Test Root" -days 3650 -sha256 -set_serial 1 \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" -out root.pem
key ca; sign ca "Test CA" root ca_ext 2
key leaf; sign leaf "Test Leaf" ca leaf_ext 3
key other; sign other "Test Other" ca leaf_ext 4
# A certificate that is not a CA but issues one
key fake; sign fake "Test Fake" ca leaf_ext 5
key fakeleaf; sign fakeleaf "Test Fake Leaf" fake leaf_ext 6
key critical; sign critical "Test Critical" ca critical_ext 7

crl root root_crl
crl root root_crl_revoked_ca ca
crl ca ca_crl
crl ca ca_crl_revoked_leaf leaf
crl ca ca_crl_expired "" 1

for name in root ca leaf other fake fakeleaf critical; do
  openssl x509 -in "$name.pem" -outform DER -out "$OUT/$name.der"
done
rm -rf "$WORK"
