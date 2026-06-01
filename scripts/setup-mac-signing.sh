#!/bin/sh
# One-time: create a stable self-signed code-signing identity ("Terax Dev")
# and import it into the login keychain. Re-runnable (skips if already present).
#
# This identity is local-dev only — it is NOT trusted by Gatekeeper (spctl will
# report "rejected"), which is fine for a locally-built app launched from
# /Applications. Its purpose is a *stable* signature so the macOS Keychain
# "Always Allow" for the AI provider keys persists across rebuilds.
set -e

IDENTITY="Terax Dev"
WORK="$HOME/.config/terax-signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  echo "identity '$IDENTITY' already present"
  exit 0
fi

mkdir -p "$WORK"
cd "$WORK"

cat > openssl.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = Terax Dev
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 3650 -nodes -config openssl.cnf
# -legacy: macOS `security import` cannot read OpenSSL 3's default PKCS12 MAC.
openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -out terax-dev.p12 -name "$IDENTITY" -passout pass:terax

# -T grants codesign/security access to the private key without a GUI prompt.
security import terax-dev.p12 -k "$KEYCHAIN" -P terax -T /usr/bin/codesign -T /usr/bin/security

echo "identity '$IDENTITY' imported. Now run: scripts/build-mac.sh"
