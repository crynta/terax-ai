#!/usr/bin/env bash
# strip-upstream.sh — re-applies fork customizations after an upstream pull.
# Idempotent: safe to run repeatedly.

set -euo pipefail

BUNDLE_ID="${BUNDLE_ID:-com.riotbeard.termax}"
PRODUCT_NAME="${PRODUCT_NAME:-TerMax}"

echo "→ Patching src-tauri/tauri.conf.json"
jq --arg id "$BUNDLE_ID" --arg name "$PRODUCT_NAME" '
  .identifier = $id
  | .productName = $name
  | .bundle.createUpdaterArtifacts = false
  | .bundle.macOS = (.bundle.macOS // {}) + {minimumSystemVersion: "11.0"}
  | del(.plugins.updater)
' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

echo "→ Stripping updater from src-tauri/src/lib.rs"
sed -i '' '/tauri_plugin_updater::Builder::new()\.build()/d' src-tauri/src/lib.rs
sed -i '' '/use tauri_plugin_updater/d' src-tauri/src/lib.rs

echo "→ Removing tauri-plugin-updater from Cargo.toml"
sed -i '' '/^tauri-plugin-updater/d' src-tauri/Cargo.toml

echo "→ Stripping updater:default permission from capabilities/desktop.json"
jq 'if .permissions then .permissions |= map(select(. != "updater:default")) else . end' \
  src-tauri/capabilities/desktop.json > src-tauri/capabilities/desktop.json.tmp
mv src-tauri/capabilities/desktop.json.tmp src-tauri/capabilities/desktop.json

echo "→ Removing src/modules/updater (frontend updater module)"
rm -rf src/modules/updater

echo "→ Removing @tauri-apps/plugin-updater from package.json (if present)"
node -e '
  const fs=require("fs"), p=JSON.parse(fs.readFileSync("package.json"));
  if (p.dependencies && p.dependencies["@tauri-apps/plugin-updater"]) {
    delete p.dependencies["@tauri-apps/plugin-updater"];
    fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
    console.log("  removed from dependencies");
  }
'

echo "→ Patching package.json (name + productName)"
node -e '
  const fs=require("fs"), p=JSON.parse(fs.readFileSync("package.json"));
  p.name = "termax";
  if (p.productName) p.productName = "TerMax";
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'

echo "→ Patching Cargo package name + lib name"
sed -i '' 's/^name = "terax"$/name = "termax"/' src-tauri/Cargo.toml
sed -i '' 's/^name = "terax_lib"$/name = "termax_lib"/' src-tauri/Cargo.toml
sed -i '' 's/terax_lib::run()/termax_lib::run()/' src-tauri/src/main.rs

echo "→ Patching HTML titles"
sed -i '' 's|<title>Terax</title>|<title>TerMax</title>|' index.html
[ -f settings.html ] && sed -i '' 's|<title>Terax — Settings</title>|<title>TerMax — Settings</title>|' settings.html

echo "→ Rebranding remaining Terax strings in src/"
find src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.html" \) -print0 \
  | xargs -0 sed -i '' -e 's/Terax/TerMax/g' -e 's/TERAX/TERMAX/g' -e 's/terax/termax/g'

if [ -f src/modules/theme/themes/terax-default.ts ]; then
  echo "→ Renaming theme file terax-default.ts → termax-default.ts"
  mv src/modules/theme/themes/terax-default.ts src/modules/theme/themes/termax-default.ts
fi

echo "✓ Strip complete. Run \`cd src-tauri && cargo check\` and \`pnpm exec tsc --noEmit\` to verify."
