param(
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$config = Join-Path $repoRoot "src-tauri\tauri.dev.windows.conf.json"
$pnpmArgs = @("tauri", "dev", "--config", $config)

if ($PrintOnly) {
  Write-Output ("pnpm " + ($pnpmArgs -join " "))
  exit 0
}

& pnpm @pnpmArgs
exit $LASTEXITCODE
