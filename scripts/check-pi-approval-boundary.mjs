#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const DEFAULT_PI_APPROVAL_BOUNDARY_RULES = {
  requiredText: [
    [
      "sidecars/pi-host/native-tools.js",
      [
        "RUST_MEDIATED_TOOL_NAMES",
        "executeNativeTool",
        "createTeraxNativeToolDefinitions",
        "Terax Rust",
      ],
    ],
    [
      "sidecars/pi-host/dist/native-tools.js",
      [
        "RUST_MEDIATED_TOOL_NAMES",
        "executeNativeTool",
        "createTeraxNativeToolDefinitions",
        "Terax Rust",
      ],
    ],
    [
      "sidecars/pi-host/fallback-capability-manifest.generated.js",
      ["create_artifact", "edit_artifact", "read_artifact", "list_artifacts"],
    ],
    [
      "sidecars/pi-host/dist/fallback-capability-manifest.generated.js",
      ["create_artifact", "edit_artifact", "read_artifact", "list_artifacts"],
    ],
    [
      "sidecars/pi-host/host.js",
      [
        "nativeTools.execute",
        "setNativeToolExecutor",
        "tryResolveHostResponse",
      ],
    ],
    [
      "sidecars/pi-host/dist/host.js",
      [
        "nativeTools.execute",
        "setNativeToolExecutor",
        "tryResolveHostResponse",
      ],
    ],
    [
      "sidecars/pi-host/sessions.js",
      [
        "rust-mediated",
        "createTeraxNativeToolDefinitions",
        "respondToToolApproval",
        "createApprovalExtension",
        "validateToolSafety",
      ],
    ],
    [
      "sidecars/pi-host/dist/sessions.js",
      [
        "rust-mediated",
        "createTeraxNativeToolDefinitions",
        "respondToToolApproval",
        "createApprovalExtension",
        "validateToolSafety",
      ],
    ],
    [
      "sidecars/pi-host/protocol.js",
      ["sessions.tool.respond", "TOOL_MODE", "validateProtocolParams"],
    ],
    [
      "sidecars/pi-host/dist/protocol.js",
      ["sessions.tool.respond", "TOOL_MODE", "validateProtocolParams"],
    ],
    [
      "sidecars/pi-host/protocol-schema.js",
      ["PI_HOST_PROTOCOL_SCHEMA", "validateProtocolParams"],
    ],
    [
      "sidecars/pi-host/dist/protocol-schema.js",
      ["PI_HOST_PROTOCOL_SCHEMA", "validateProtocolParams"],
    ],
    ["sidecars/pi-host/session-errors.js", ["PI_APPROVAL_NOT_FOUND"]],
    ["sidecars/pi-host/dist/session-errors.js", ["PI_APPROVAL_NOT_FOUND"]],
    [
      "sidecars/pi-host/host.test.js",
      ["nativeTools.execute", "round-trips Rust native tool requests"],
    ],
    [
      "sidecars/pi-host/session-approvals.test.js",
      [
        "delegates read-only faux tool calls to the Rust native tool bridge",
        "requires approval before running shell faux tool calls",
        "PI_APPROVAL_NOT_FOUND",
      ],
    ],
    ["sidecars/pi-host/session-utils.test.js", ["rust-mediated"]],
    [
      "sidecars/pi-host/protocol.test.js",
      ["rust-mediated", "sessions.tool.respond"],
    ],
    [
      "src-tauri/src/modules/pi/native_tools.rs",
      [
        "NativeToolRequest",
        "execute_with_context",
        "mediatedBy",
        "create_artifact",
        "grep_skips_sensitive_files_inside_workspace",
      ],
    ],
    [
      "src-tauri/src/modules/pi/host.rs",
      ["native_tool_sessions", "NativeToolContext"],
    ],
    [
      "src-tauri/src/modules/pi/host/bridge.rs",
      [
        "nativeTools.execute",
        "execute_verified_native_tool",
        "native_tool_sessions",
      ],
    ],
    [
      "src-tauri/src/modules/pi/host/tests.rs",
      ["host_handles_reverse_native_tool_requests"],
    ],
    [
      "src-tauri/src/modules/pi/mod.rs",
      ["PiSessionToolRespondResult", "pi_session_tool_respond"],
    ],
    [
      "src-tauri/src/modules/pi/state/compat.rs",
      ["session_tool_respond_with_resource_dir"],
    ],
    ["src-tauri/src/lib.rs", ["pi::pi_session_tool_respond"]],
    [
      "src-tauri/tests/pi_state.rs",
      [
        "rust-mediated",
        "tool_approval_responses_are_forwarded_to_the_sidecar",
        "wait_for_event",
      ],
    ],
    [
      "src/modules/pi/lib/native.ts",
      [
        "PiSessionToolRespondResult",
        "sessionToolRespond",
        "sessionRename",
        "sessionDelete",
      ],
    ],
    ["src/modules/pi/lib/native.test.ts", ["responds to Pi tool approvals"]],
    ["src/modules/pi/lib/sessions/types.ts", ["PiSessionToolRespondResult"]],
    ["src/modules/pi/PiPanel.tsx", ["respondToToolApproval", "onToolApproval"]],
    [
      "src/modules/pi/components/PiTranscript.tsx",
      ["onToolApproval", "Approve", "Deny"],
    ],
    [
      "src/modules/pi/components/PiTranscript.test.tsx",
      ["renders approval requests with approval-gated actions"],
    ],
    [
      "src/modules/pi/lib/diagnostics.test.ts",
      ["rust-mediated", "Tools enabled"],
    ],
    ["src/modules/pi/components/PiDiagnosticsCard.test.tsx", ["rust-mediated"]],
    [
      "scripts/smoke-pi-host-bundle.mjs",
      ["rust-mediated", "expectedEnabledTools", "expectedApprovalTools"],
    ],
    [
      "docs/pi-runtime.md",
      ["rust-mediated", "nativeTools.execute", "sessions.tool.respond"],
    ],
    [
      "docs/pi-native-tool-bridge.md",
      ["rust-mediated", "nativeTools.execute", "PI_APPROVAL_NOT_FOUND"],
    ],
    [
      "docs/pi-session-protocol.md",
      ["rust-mediated", "nativeTools.execute", "sessions.tool.respond"],
    ],
    [
      "docs/pi-sidebar-verification.md",
      ["rust-mediated", "PI_APPROVAL_NOT_FOUND"],
    ],
  ],
  forbiddenText: [
    ["src-tauri/tests/pi_state.rs", ["noTools", 'tool_mode, "approval-gated"']],
    [
      "src/modules/pi/lib/diagnostics.test.ts",
      ["noTools", "No Pi tools", "approval-gated"],
    ],
    [
      "src/modules/pi/components/PiDiagnosticsCard.test.tsx",
      ["noTools", "approval-gated"],
    ],
    [
      "scripts/smoke-pi-host-bundle.mjs",
      [
        'toolMode !== "noTools"',
        'toolMode !== "approval-gated"',
        "expectedEnabledTools = []",
        "expectedApprovalTools = []",
      ],
    ],
    [
      "sidecars/pi-host/session-approvals.test.js",
      ["while tools are disabled", "Method not found"],
    ],
    [
      "sidecars/pi-host/protocol.test.js",
      ['toolMode: "noTools"', 'toolMode: "approval-gated"'],
    ],
    [
      "sidecars/pi-host/sessions.js",
      [
        'TOOL_MODE = "noTools"',
        'TOOL_MODE = "approval-gated"',
        'noTools: "all"',
      ],
    ],
    [
      "sidecars/pi-host/dist/sessions.js",
      [
        'TOOL_MODE = "noTools"',
        'TOOL_MODE = "approval-gated"',
        'noTools: "all"',
      ],
    ],
  ],
  forbiddenPiDocText: [
    'toolMode: "approval-gated"',
    '`toolMode: "approval-gated"`',
    '"toolMode": "approval-gated"',
    "approval-gated SDK tools",
    "Pi SDK tool allowlist",
    "SDK tool boundary",
    "SDK tools remain disabled",
    "Pi SDK tools are currently disabled",
    "Pi SDK tools stay disabled",
    "Keep Pi tools disabled",
    "tools disabled by default",
    "noTools",
    "tools: []",
    "until a reviewed Rust-mediated bridge is implemented",
  ],
  identicalFiles: [
    ["sidecars/pi-host/host.js", "sidecars/pi-host/dist/host.js"],
    [
      "sidecars/pi-host/native-tools.js",
      "sidecars/pi-host/dist/native-tools.js",
    ],
    ["sidecars/pi-host/sessions.js", "sidecars/pi-host/dist/sessions.js"],
    [
      "sidecars/pi-host/protocol-schema.js",
      "sidecars/pi-host/dist/protocol-schema.js",
    ],
    ["sidecars/pi-host/protocol.js", "sidecars/pi-host/dist/protocol.js"],
    [
      "sidecars/pi-host/session-errors.js",
      "sidecars/pi-host/dist/session-errors.js",
    ],
    [
      "sidecars/pi-host/provider-config.js",
      "sidecars/pi-host/dist/provider-config.js",
    ],
  ],
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

  for (const [sourcePath, distPath] of rules.identicalFiles) {
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
