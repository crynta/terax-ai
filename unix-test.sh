#!/bin/bash
# Terax macOS/Linux Build Test Script
# Run this on macOS or Linux to verify the build works

set -e

echo "=== Terax macOS/Linux Build Test ==="

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v rustc &> /dev/null; then
    echo "ERROR: Rust not found. Install from https://rustup.rs"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found. Install Node 20+."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "ERROR: pnpm not found. Install via: npm install -g pnpm"
    exit 1
fi

echo "Node: $(node --version)"
echo "Rust: $(rustc --version)"

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Platform: macOS"
    TARGET=""
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Platform: Linux"
    TARGET=""
else
    echo "ERROR: Unknown platform: $OSTYPE"
    exit 1
fi

# Install Linux dependencies if needed
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo ""
    echo "Installing Linux build dependencies..."
    sudo apt-get update
    sudo apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        librsvg2-dev \
        libssl-dev \
        patchelf
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
pnpm install --frozen-lockfile

# TypeScript type-check
echo ""
echo "Running TypeScript type-check..."
pnpm exec tsc --noEmit

# Rust clippy
echo ""
echo "Running Rust clippy..."
cd src-tauri
cargo clippy -- -D warnings
cd ..

# Build
echo ""
echo "Building Tauri..."
pnpm tauri build

echo ""
echo "=== macOS/Linux Build Test PASSED ==="