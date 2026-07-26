#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PACKAGE="$ROOT/native/speech-bridge-macos"
CHECKOUT="$PACKAGE/.build/checkouts/speech-swift"
PATCH="$PACKAGE/patches/speech-swift-parakeet-local.patch"
EXPECTED_REVISION=7609977be837a6529bd04300c6b963e735300070

swift package --package-path "$PACKAGE" resolve

ACTUAL_REVISION=$(git -C "$CHECKOUT" rev-parse HEAD)
if [[ "$ACTUAL_REVISION" != "$EXPECTED_REVISION" ]]; then
  echo "speech-swift revision mismatch: expected $EXPECTED_REVISION, got $ACTUAL_REVISION" >&2
  exit 1
fi

if git -C "$CHECKOUT" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
  exit 0
fi

chmod u+w "$CHECKOUT/Sources/ParakeetStreamingASR/ParakeetStreamingASR.swift"
git -C "$CHECKOUT" apply --check "$PATCH"
git -C "$CHECKOUT" apply "$PATCH"
