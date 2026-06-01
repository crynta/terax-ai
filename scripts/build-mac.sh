#!/bin/sh
# Build Terax for macOS, re-sign with the stable local dev identity, install.
#
# Why: `tauri build` ad-hoc signs the bundle. Ad-hoc identity changes per build,
# so the macOS Keychain re-prompts for the AI provider keys every launch. Signing
# with a stable self-signed cert ("Terax Dev") lets "Always Allow" stick.
#
# One-time setup of the cert lives in scripts/setup-mac-signing.sh.
set -e
cd "$(dirname "$0")/.."

IDENTITY="Terax Dev"
APP="src-tauri/target/release/bundle/macos/Terax.app"

if ! security find-identity -p codesigning 2>/dev/null | grep -q "$IDENTITY"; then
  echo "signing identity '$IDENTITY' not found — run scripts/setup-mac-signing.sh first" >&2
  exit 1
fi

# tauri build exits non-zero only on updater-artifact signing (no private key set);
# the .app bundle is already produced by that point, so guard on its presence instead.
pnpm tauri build || true

[ -d "$APP" ] || { echo "build failed: $APP not produced" >&2; exit 1; }

codesign --force --deep --sign "$IDENTITY" --identifier app.crynta.terax "$APP"
codesign --verify --deep --strict "$APP"

rm -rf /Applications/Terax.app
cp -R "$APP" /Applications/
xattr -dr com.apple.quarantine /Applications/Terax.app 2>/dev/null || true
echo "signed + installed: /Applications/Terax.app"
