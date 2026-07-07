#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_RELEASE_READINESS_TEXT = [
  "mergeStateStatus=DIRTY",
  "GitHub Actions and Linux e2e are not available",
  "CI must independently run on the PR",
  "docs/pi-sidebar-manual-smoke-report.md",
  "Complete Phase C/D convergence",
  "Pi-backed quick ask",
  "Runtime collapse/rename remains deferred",
  "pnpm run check:pi-surface-isolation",
  "TAURI_SIGNING_PRIVATE_KEY",
  "new-key signed release or test feed",
  "Maintainer must verify/configure signing secret values",
  "pnpm run inspect:updater-feed",
  "Node Pi sidecar deleted",
  "pnpm run check:no-pi-sidecar",
  "pnpm run check:tauri-invokes",
  "pnpm check:updater-key-rotation",
  "11M",
  "1949.8 KB",
];

export const REQUIRED_MANUAL_SMOKE_SECTIONS = [
  "Key save and reload",
  "Terax-managed Pi chat",
  "Built-in and local agent cards",
  "Custom Zai/OpenAI-compatible endpoint auth",
  "Session streaming and persistence",
  "Tool approval approve path",
  "Tool approval deny path",
  "Stop and resume",
  "App restart restore",
  "Window close behavior",
  "Size spot check after final merge",
];

export const REQUIRED_MANUAL_SMOKE_TEXT = [
  "real provider credentials",
  "custom OpenAI-compatible Zai endpoint",
  "Do not paste real secret values",
  "pi-smoke-approved.txt",
  "pi-smoke-denied.txt",
  "Stale approvals are not actionable",
  "No `sidecars/pi-host` or Node Pi runtime resource is present",
];

async function readDoc(root, path, errors) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    errors.push(`${path} could not be read: ${error.message}`);
    return "";
  }
}

function requireText(text, path, needles, errors) {
  for (const needle of needles) {
    if (!text.includes(needle)) {
      errors.push(`${path} missing required release-readiness text: ${needle}`);
    }
  }
}

export async function checkPiReleaseDocs(root = repoRoot) {
  const errors = [];
  const releaseReadinessPath = "docs/pi-sidebar-release-readiness.md";
  const manualSmokePath = "docs/pi-sidebar-manual-smoke-report.md";
  const releaseReadiness = await readDoc(root, releaseReadinessPath, errors);
  const manualSmoke = await readDoc(root, manualSmokePath, errors);

  requireText(releaseReadiness, releaseReadinessPath, REQUIRED_RELEASE_READINESS_TEXT, errors);
  requireText(manualSmoke, manualSmokePath, REQUIRED_MANUAL_SMOKE_SECTIONS, errors);
  requireText(manualSmoke, manualSmokePath, REQUIRED_MANUAL_SMOKE_TEXT, errors);

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkPiReleaseDocs(repoRoot);
  if (!result.ok) {
    console.error("Pi release docs check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Pi release docs check passed");
}
