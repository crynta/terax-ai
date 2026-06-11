#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// The Pi runtime is the webview agent: the webview proposes tool calls, Rust
// disposes. These rules fail CI if the verified-executor routing, the approval
// grant, or the Rust enforcement is removed. (The Node sidecar was deleted; its
// rules went with it.)
export const DEFAULT_PI_APPROVAL_BOUNDARY_RULES = {
  requiredText: [
    [
      "src-tauri/src/modules/pi/native_tools.rs",
      ["NativeToolRequest", "execute_with_context", "mediatedBy"],
    ],
    [
      "src-tauri/src/modules/pi/agent_tools.rs",
      [
        "pub fn pi_agent_tool_execute",
        "pub fn pi_approval_grant",
        "authorize_spawn_cwd",
        "evaluate_tool_policy",
        "CapabilityAuditOutcome::Blocked",
      ],
    ],
    [
      "src/modules/pi/bridge/pi-tools.ts",
      ["pi_agent_tool_execute", "pi_approval_grant", "executeAgentTool"],
    ],
    [
      "src/modules/pi/bridge/pi-session.ts",
      ["executeAgentTool", "grantAgentTool", "AGENT_TO_NATIVE_TOOL"],
    ],
    [
      "src/modules/pi/bridge/pi-session.boundary.test.ts",
      [
        "a denied gate never reaches the executor",
        "records a grant for the native tool name",
      ],
    ],
    [
      "src/modules/pi/bridge/pi-tools.test.ts",
      ["routes through pi_agent_tool_execute", "single-use grant"],
    ],
    [
      "src-tauri/src/lib.rs",
      ["pi::pi_agent_tool_execute", "pi::pi_approval_grant"],
    ],
  ],
  forbiddenText: [
    [
      "src/modules/pi/lib/diagnostics.test.ts",
      ["noTools", "No Pi tools", "approval-gated"],
    ],
    [
      "src/modules/pi/components/PiDiagnosticsCard.test.tsx",
      ["noTools", "approval-gated"],
    ],
  ],
  forbiddenPiDocText: [],
  identicalFiles: [],
};

async function readText(root, relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

async function listPiDocs(root) {
  try {
    const names = await readdir(resolve(root, "docs"));
    return names
      .filter((name) => name.startsWith("pi-") && name.endsWith(".md"))
      .map((name) => `docs/${name}`);
  } catch {
    return [];
  }
}

export async function checkPiApprovalBoundary(
  root = repoRoot,
  rules = DEFAULT_PI_APPROVAL_BOUNDARY_RULES,
) {
  const errors = [];
  const cache = new Map();
  const get = async (relativePath) => {
    if (!cache.has(relativePath)) {
      try {
        cache.set(relativePath, await readText(root, relativePath));
      } catch (error) {
        errors.push(`${relativePath} could not be read: ${error.message}`);
        cache.set(relativePath, "");
      }
    }
    return cache.get(relativePath);
  };

  for (const [relativePath, needles] of rules.requiredText) {
    const text = await get(relativePath);
    for (const needle of needles) {
      if (!text.includes(needle)) {
        errors.push(`${relativePath} missing required text: ${needle}`);
      }
    }
  }

  for (const [relativePath, needles] of rules.forbiddenText) {
    const text = await get(relativePath);
    for (const needle of needles) {
      if (text.includes(needle)) {
        errors.push(`${relativePath} contains stale text: ${needle}`);
      }
    }
  }

  for (const relativePath of await listPiDocs(root)) {
    const text = await get(relativePath);
    for (const needle of rules.forbiddenPiDocText ?? []) {
      if (text.includes(needle)) {
        errors.push(`${relativePath} contains stale Pi docs text: ${needle}`);
      }
    }
  }

  for (const [sourcePath, distPath] of rules.identicalFiles ?? []) {
    const source = await get(sourcePath);
    const dist = await get(distPath);
    if (source !== dist) {
      errors.push(`${sourcePath} does not match ${distPath}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkPiApprovalBoundary(repoRoot);
  if (!result.ok) {
    console.error("Pi approval boundary check failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log("Pi approval boundary check passed");
}
