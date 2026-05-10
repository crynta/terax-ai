# Terax Windows Build Test Script
# Run this on a Windows machine to verify the build works

$ErrorActionPreference = "Stop"

Write-Host "=== Terax Windows Build Test ===" -ForegroundColor Cyan

# Check prerequisites
Write-Host "`nChecking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Rust not found. Install from https://rustup.rs" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js not found. Install Node 20+." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: pnpm not found. Install via: npm install -g pnpm" -ForegroundColor Red
    exit 1
}

$nodeVersion = node --version
Write-Host "Node: $nodeVersion" -ForegroundColor Green

$rustVersion = rustc --version
Write-Host "Rust: $rustVersion" -ForegroundColor Green

# Add Windows target
Write-Host "`nAdding Windows MSVC target..." -ForegroundColor Yellow
rustup target add x86_64-pc-windows-msvc

# Install dependencies
Write-Host "`nInstalling dependencies..." -ForegroundColor Yellow
pnpm install --frozen-lockfile

# TypeScript type-check
Write-Host "`nRunning TypeScript type-check..." -ForegroundColor Yellow
pnpm exec tsc --noEmit

# Rust clippy
Write-Host "`nRunning Rust clippy..." -ForegroundColor Yellow
cd src-tauri
cargo clippy --target x86_64-pc-windows-msvc -- -D warnings
cd ..

# Build
Write-Host "`nBuilding Tauri for Windows..." -ForegroundColor Yellow
pnpm tauri build --target x86_64-pc-windows-msvc

Write-Host "`n=== Windows Build Test PASSED ===" -ForegroundColor Green