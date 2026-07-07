#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const EXPECTED_UPDATER_KEY_ID = "52D6B9847A3B8F15";
export const OLD_UPDATER_KEY_ID = "3BABFD8AB60E3469";
export const EXPECTED_UPDATE_ENDPOINT = "https://github.com/crynta/terax-ai/releases/latest/download/latest.json";
export const EXPECTED_FEED_INSPECTOR_SCRIPT = "node scripts/inspect-updater-feed.mjs";

const requiredSigningSecretPatterns = [
  /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY\s*\}\}/,
  /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*\}\}/,
];

const requiredFeedInspectorText = [
  EXPECTED_UPDATE_ENDPOINT,
  "--expect-key",
  "signatureKeyIdFromTauriSignature",
];

export const REQUIRED_UPDATER_DOC_TEXT = [
  OLD_UPDATER_KEY_ID,
  EXPECTED_UPDATER_KEY_ID,
  EXPECTED_UPDATE_ENDPOINT,
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "Preferred transition-release path",
  "Fallback reinstall-announcement path",
  "new-key signed release or test feed",
  "pnpm run inspect:updater-feed",
  "End-to-end update verified on a new install and an old install against a signed test feed",
  "Fresh/pre-rotation acceptance still needs a signed release or test feed",
];

async function readText(path) {
  return readFile(path, "utf8");
}

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${label} could not be parsed as JSON: ${error.message}`);
    return null;
  }
}

function decodeUpdaterPubkey(pubkey, errors) {
  if (typeof pubkey !== "string" || pubkey.length === 0) {
    errors.push("src-tauri/tauri.conf.json is missing plugins.updater.pubkey");
    return "";
  }

  try {
    return Buffer.from(pubkey, "base64").toString("utf8");
  } catch (error) {
    errors.push(`plugins.updater.pubkey could not be base64-decoded: ${error.message}`);
    return "";
  }
}

function checkTauriConfig(config, errors) {
  const updater = config?.plugins?.updater;
  const decodedPubkey = decodeUpdaterPubkey(updater?.pubkey, errors);

  if (!decodedPubkey.includes(`minisign public key: ${EXPECTED_UPDATER_KEY_ID}`)) {
    errors.push(`embedded updater pubkey does not decode to expected key id ${EXPECTED_UPDATER_KEY_ID}`);
  }

  if (decodedPubkey.includes(OLD_UPDATER_KEY_ID)) {
    errors.push(`embedded updater pubkey still contains old key id ${OLD_UPDATER_KEY_ID}`);
  }

  const endpoints = Array.isArray(updater?.endpoints) ? updater.endpoints : [];
  if (!endpoints.includes(EXPECTED_UPDATE_ENDPOINT)) {
    errors.push(`updater endpoints do not include ${EXPECTED_UPDATE_ENDPOINT}`);
  }

  return { decodedPubkey, endpoints };
}

function checkReleaseWorkflow(text, errors) {
  const actionMatch = text.match(/tauri-apps\/tauri-action@v\d+/);
  if (!actionMatch) {
    errors.push(".github/workflows/release.yml does not use tauri-apps/tauri-action");
  }

  for (const pattern of requiredSigningSecretPatterns) {
    if (!pattern.test(text)) {
      errors.push(`.github/workflows/release.yml is missing required signing env: ${pattern.source}`);
    }
  }

  return { action: actionMatch?.[0] ?? null };
}

function checkUpdaterDocs(text, errors) {
  for (const requiredText of REQUIRED_UPDATER_DOC_TEXT) {
    if (!text.includes(requiredText)) {
      errors.push(`docs/updater-key-rotation.md is missing required rotation note: ${requiredText}`);
    }
  }
}

function checkFeedInspector(packageText, inspectorText, errors) {
  const packageJson = parseJson(packageText, "package.json", errors);
  if (packageJson?.scripts?.["inspect:updater-feed"] !== EXPECTED_FEED_INSPECTOR_SCRIPT) {
    errors.push(`package.json is missing inspect:updater-feed script: ${EXPECTED_FEED_INSPECTOR_SCRIPT}`);
  }

  for (const requiredText of requiredFeedInspectorText) {
    if (!inspectorText.includes(requiredText)) {
      errors.push(`scripts/inspect-updater-feed.mjs is missing required feed-inspector text: ${requiredText}`);
    }
  }
}

export async function checkUpdaterKeyRotation(root = repoRoot) {
  const errors = [];
  const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
  const releaseWorkflowPath = resolve(root, ".github/workflows/release.yml");
  const updaterDocsPath = resolve(root, "docs/updater-key-rotation.md");
  const packageJsonPath = resolve(root, "package.json");
  const feedInspectorPath = resolve(root, "scripts/inspect-updater-feed.mjs");

  let tauri = { decodedPubkey: "", endpoints: [] };
  try {
    const config = parseJson(await readText(tauriConfigPath), "src-tauri/tauri.conf.json", errors);
    if (config) tauri = checkTauriConfig(config, errors);
  } catch (error) {
    errors.push(`src-tauri/tauri.conf.json could not be read: ${error.message}`);
  }

  let workflow = { action: null };
  try {
    workflow = checkReleaseWorkflow(await readText(releaseWorkflowPath), errors);
  } catch (error) {
    errors.push(`.github/workflows/release.yml could not be read: ${error.message}`);
  }

  try {
    checkUpdaterDocs(await readText(updaterDocsPath), errors);
  } catch (error) {
    errors.push(`docs/updater-key-rotation.md could not be read: ${error.message}`);
  }

  try {
    checkFeedInspector(await readText(packageJsonPath), await readText(feedInspectorPath), errors);
  } catch (error) {
    errors.push(`updater feed inspector wiring could not be read: ${error.message}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    decodedPubkey: tauri.decodedPubkey,
    endpoints: tauri.endpoints,
    workflowAction: workflow.action,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkUpdaterKeyRotation(repoRoot);
  if (!result.ok) {
    console.error("Updater key rotation check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    `Updater key rotation check passed: embedded key ${EXPECTED_UPDATER_KEY_ID}, ${result.workflowAction}, ${result.endpoints.length} endpoint(s), cutover docs and feed inspector guarded.`,
  );
}
