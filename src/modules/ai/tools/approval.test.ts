import { beforeEach, describe, expect, it } from "vitest";

import { usePreferencesStore } from "@/modules/settings/preferences";
import { gateApproval, type ToolContext } from "./context";
import { buildShellTools } from "./shell";

const ctxStub: ToolContext = {
  getCwd: () => null,
  getWorkspaceRoot: () => null,
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "session-1",
};

// The AI SDK's tool() execute takes (input, options); our impls ignore options.
const run = (
  fn: unknown,
  input: unknown,
): Promise<{ error?: string }> =>
  (fn as (i: unknown, o: unknown) => Promise<{ error?: string }>)(input, {});

beforeEach(() => {
  usePreferencesStore.setState({ aiBypassPermissions: false });
});

describe("gateApproval", () => {
  it("requires approval by default (bypass off)", () => {
    expect(gateApproval()).toBe(true);
  });

  it("skips approval when bypass is enabled", () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    expect(gateApproval()).toBe(false);
  });
});

// The security invariant: bypass only drops the approval prompt. The deny-list
// in each tool's execute must still reject, otherwise a destructive command
// would auto-run. If the guard were skipped, execute would fall through to
// native (which throws under test) and the error would NOT name the deny reason.
describe("bypass never weakens the shell deny-list", () => {
  it("bash_run still refuses 'rm -rf /' with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildShellTools(ctxStub);
    const res = await run(tools.bash_run.execute, { command: "rm -rf /" });
    expect(res.error).toContain("filesystem root");
  });

  it("bash_background still refuses a fork bomb with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildShellTools(ctxStub);
    const res = await run(tools.bash_background.execute, {
      command: ":(){ :|:& };:",
    });
    expect(res.error).toContain("fork-bomb");
  });
});
