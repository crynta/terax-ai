#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_CI_RELEASE_GATES = [
  { label: "manual dispatch trigger", text: "workflow_dispatch:" },
  { label: "PR trigger", text: "pull_request:" },
  { label: "production audit", text: "pnpm audit --prod --audit-level high" },
  { label: "typecheck", text: "pnpm exec tsc --noEmit" },
  { label: "lint", text: "pnpm lint" },
  { label: "format", text: "pnpm format:check" },
  { label: "sidecar build", text: "pnpm build:sidecars" },
  { label: "Pi boundary", text: "pnpm check:pi-boundary" },
  { label: "updater key rotation", text: "pnpm check:updater-key-rotation" },
  { label: "frontend unit tests", text: "pnpm test" },
  { label: "frontend coverage", text: "pnpm test:coverage" },
  { label: "frontend build", text: "pnpm build" },
  { label: "bundle-size budget", text: "pnpm check:bundle-size" },
  { label: "Rust check", text: "cargo check --all-targets --locked" },
  { label: "Rust clippy", text: "cargo clippy --all-targets --locked -- -D warnings" },
  { label: "Rust nextest", text: "cargo nextest run --locked" },
  { label: "Rust platform retry", text: "cargo nextest run --locked --retries 2" },
  { label: "Linux WebKit driver", text: "webkit2gtk-driver" },
  { label: "Tauri driver", text: "tauri-driver" },
  { label: "Linux e2e", text: "xvfb-run -a pnpm e2e" },
  { label: "Rust coverage", text: "cargo llvm-cov nextest --locked --lcov --output-path lcov.info" },
];

async function readWorkflow(root) {
  return readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
}

export async function checkCiReleaseGates(root = repoRoot) {
  const errors = [];
  let text = "";
  try {
    text = await readWorkflow(root);
  } catch (error) {
    errors.push(`.github/workflows/ci.yml could not be read: ${error.message}`);
    return { ok: false, errors };
  }

  for (const gate of REQUIRED_CI_RELEASE_GATES) {
    if (!text.includes(gate.text)) {
      errors.push(`.github/workflows/ci.yml is missing required ${gate.label} gate: ${gate.text}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkCiReleaseGates(repoRoot);
  if (!result.ok) {
    console.error("CI release gates check failed:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`CI release gates check passed: ${REQUIRED_CI_RELEASE_GATES.length} required gates present.`);
}
