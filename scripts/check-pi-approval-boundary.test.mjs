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

// A fixture that satisfies every requiredText rule for the webview agent
// enforcement path and contains none of the forbidden text.
const healthyFiles = {
  "src-tauri/src/modules/pi/native_tools.rs":
    "NativeToolRequest execute_with_context mediatedBy",
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
  "src-tauri/src/lib.rs":
    "pi::pi_agent_tool_execute pi::pi_approval_grant",
  "src/modules/pi/lib/diagnostics.test.ts": "rust-mediated tools enabled",
  "src/modules/pi/components/PiDiagnosticsCard.test.tsx": "rust-mediated",
};

describe("checkPiApprovalBoundary", () => {
  it("passes when the webview agent enforcement path is intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-boundary-ok-"));
    await writeFixture(root, healthyFiles);

    const result = await checkPiApprovalBoundary(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when the Rust executor or grant routing is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-boundary-bad-"));
    await writeFixture(root, {
      ...healthyFiles,
      // Rust enforcement stripped of the grant command + audit block.
      "src-tauri/src/modules/pi/agent_tools.rs":
        "pub fn pi_agent_tool_execute authorize_spawn_cwd",
      // Diagnostics test regressed to the old disabled-tools posture.
      "src/modules/pi/lib/diagnostics.test.ts": "approval-gated noTools",
    });

    const result = await checkPiApprovalBoundary(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "src-tauri/src/modules/pi/agent_tools.rs missing required text: pub fn pi_approval_grant",
        ),
        expect.stringContaining(
          "src/modules/pi/lib/diagnostics.test.ts contains stale text: approval-gated",
        ),
      ]),
    );
  });
});
