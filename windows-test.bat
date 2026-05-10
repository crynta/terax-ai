@echo off
REM Terax Windows Build Test Script (CMD)
REM Run this on a Windows machine to verify the build works

echo === Terax Windows Build Test ===

REM Check prerequisites
where rustc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Rust not found. Install from https://rustup.rs
    exit /b 1
)

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found. Install Node 20+.
    exit /b 1
)

where pnpm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pnpm not found. Install via: npm install -g pnpm
    exit /b 1
)

echo Node: %nodeVersion%
rustc --version

echo.
echo Adding Windows MSVC target...
rustup target add x86_64-pc-windows-msvc

echo.
echo Installing dependencies...
pnpm install --frozen-lockfile

echo.
echo Running TypeScript type-check...
pnpm exec tsc --noEmit

echo.
echo Running Rust clippy...
cd src-tauri
cargo clippy --target x86_64-pc-windows-msvc -- -D warnings
cd ..

echo.
echo Building Tauri for Windows...
pnpm tauri build --target x86_64-pc-windows-msvc

echo.
echo === Windows Build Test PASSED ===
exit /b 0