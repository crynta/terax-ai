import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPiApprovalBoundary } from "./check-pi-approval-boundary.mjs";

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

const hostSource =
  "nativeTools.execute setNativeToolExecutor tryResolveHostResponse";
const nativeToolsSource =
  "RUST_MEDIATED_TOOL_NAMES executeNativeTool createTeraxNativeToolDefinitions Terax Rust";
const fallbackManifestSource =
  "create_artifact edit_artifact read_artifact list_artifacts";
const sessionsSource =
  'export const TOOL_MODE = "rust-mediated"; createTeraxNativeToolDefinitions(); function respondToToolApproval(){} function createApprovalExtension(){} function validateToolSafety(){}';
const protocolSource =
  'const methods = ["sessions.tool.respond"]; TOOL_MODE; validateProtocolParams;';
const protocolSchemaSource = "PI_HOST_PROTOCOL_SCHEMA validateProtocolParams";

const healthyFiles = {
  "sidecars/pi-host/host.js": hostSource,
  "sidecars/pi-host/dist/host.js": hostSource,
  "sidecars/pi-host/native-tools.js": nativeToolsSource,
  "sidecars/pi-host/dist/native-tools.js": nativeToolsSource,
  "sidecars/pi-host/fallback-capability-manifest.generated.js":
    fallbackManifestSource,
  "sidecars/pi-host/dist/fallback-capability-manifest.generated.js":
    fallbackManifestSource,
  "sidecars/pi-host/sessions.js": sessionsSource,
  "sidecars/pi-host/dist/sessions.js": sessionsSource,
  "sidecars/pi-host/protocol.js": protocolSource,
  "sidecars/pi-host/dist/protocol.js": protocolSource,
  "sidecars/pi-host/protocol-schema.js": protocolSchemaSource,
  "sidecars/pi-host/dist/protocol-schema.js": protocolSchemaSource,
  "sidecars/pi-host/provider-config.js": "provider config",
  "sidecars/pi-host/dist/provider-config.js": "provider config",
  "sidecars/pi-host/session-errors.js": 'const code = "PI_APPROVAL_NOT_FOUND";',
  "sidecars/pi-host/dist/session-errors.js":
    'const code = "PI_APPROVAL_NOT_FOUND";',
  "sidecars/pi-host/host.test.js":
    "nativeTools.execute round-trips Rust native tool requests",
  "sidecars/pi-host/session-approvals.test.js":
    "delegates read-only faux tool calls to the Rust native tool bridge requires approval before running shell faux tool calls PI_APPROVAL_NOT_FOUND",
  "sidecars/pi-host/session-utils.test.js": "rust-mediated",
  "sidecars/pi-host/protocol.test.js": "rust-mediated sessions.tool.respond",
  "src-tauri/src/modules/pi/native_tools.rs":
    "NativeToolRequest execute_with_context mediatedBy create_artifact grep_skips_sensitive_files_inside_workspace",
  "src-tauri/src/modules/pi/host.rs":
    "native_tool_sessions NativeToolContext",
  "src-tauri/src/modules/pi/host/bridge.rs":
    "nativeTools.execute execute_verified_native_tool native_tool_sessions",
  "src-tauri/src/modules/pi/host/tests.rs":
    "host_handles_reverse_native_tool_requests",
  "src-tauri/src/modules/pi/mod.rs":
    "PiSessionToolRespondResult pi_session_tool_respond",
  "src-tauri/src/modules/pi/state/compat.rs":
    "session_tool_respond_with_resource_dir",
  "src-tauri/src/lib.rs":
    "pi::pi_session_tool_respond pi::pi_agent_tool_execute pi::pi_approval_grant",
  "src-tauri/tests/pi_state.rs":
    "rust-mediated tool_approval_responses_are_forwarded_to_the_sidecar wait_for_event",
  "src/modules/pi/lib/native.ts":
    "PiSessionToolRespondResult sessionToolRespond sessionRename sessionDelete",
  "src/modules/pi/lib/native.test.ts": "responds to Pi tool approvals",
  "src/modules/pi/lib/sessions/types.ts": "PiSessionToolRespondResult",
  "src/modules/pi/PiPanel.tsx": "respondToToolApproval onToolApproval",
  "src/modules/pi/components/PiTranscript.tsx": "onToolApproval Approve Deny",
  "src/modules/pi/components/PiTranscript.test.tsx":
    "renders approval requests with approval-gated actions",
  "src/modules/pi/lib/diagnostics.test.ts": "rust-mediated Tools enabled",
  "src/modules/pi/components/PiDiagnosticsCard.test.tsx": "rust-mediated",
  "scripts/smoke-pi-host-bundle.mjs":
    "rust-mediated expectedEnabledTools expectedApprovalTools",
  "docs/pi-runtime.md":
    "rust-mediated nativeTools.execute sessions.tool.respond",
  "docs/pi-native-tool-bridge.md":
    "rust-mediated nativeTools.execute PI_APPROVAL_NOT_FOUND",
  "docs/pi-session-protocol.md":
    "rust-mediated nativeTools.execute sessions.tool.respond",
  "docs/pi-sidebar-verification.md": "rust-mediated PI_APPROVAL_NOT_FOUND",
  "src-tauri/src/modules/pi/agent_tools.rs":
    "pub fn pi_agent_tool_execute pub fn pi_approval_grant authorize_spawn_cwd evaluate_tool_policy CapabilityAuditOutcome::Blocked",
  "src/modules/pi/bridge/pi-tools.ts":
    "pi_agent_tool_execute pi_approval_grant executeAgentTool",
  "src/modules/pi/bridge/pi-session.ts":
    "executeAgentTool grantAgentTool AGENT_TO_NATIVE_TOOL",
  "src/modules/pi/bridge/pi-session.boundary.test.ts":
    "a denied gate never reaches the executor records a grant for the native tool name",
  "src/modules/pi/bridge/pi-tools.test.ts":
    "routes through pi_agent_tool_execute single-use grant",
};

describe("checkPiApprovalBoundary", () => {
  it("passes when source, dist, tests, and docs describe Rust-mediated tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-boundary-ok-"));
    await writeFixture(root, healthyFiles);

    const result = await checkPiApprovalBoundary(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails on stale tool posture text, stale Pi docs, and source/dist drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-boundary-bad-"));
    await writeFixture(root, {
      ...healthyFiles,
      "docs/pi-native-tool-bridge.md":
        'The sidecar reports `toolMode: "approval-gated"` and has an SDK tool boundary.',
      "src-tauri/tests/pi_state.rs":
        'assert_eq!(diagnostics.config.tool_mode, "approval-gated");',
      "src/modules/pi/lib/native.ts": "sessionRename sessionDelete",
      "sidecars/pi-host/sessions.js": 'export const TOOL_MODE = "noTools";',
    });

    const result = await checkPiApprovalBoundary(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/pi-native-tool-bridge.md contains stale Pi docs text: toolMode: "approval-gated"',
        ),
        expect.stringContaining(
          "src-tauri/tests/pi_state.rs missing required text: rust-mediated",
        ),
        expect.stringContaining(
          "src/modules/pi/lib/native.ts missing required text: sessionToolRespond",
        ),
        expect.stringContaining(
          "sidecars/pi-host/sessions.js does not match sidecars/pi-host/dist/sessions.js",
        ),
      ]),
    );
  });
});
