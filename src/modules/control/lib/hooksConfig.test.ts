import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentHooksInstalled,
  applyAgentHooksPlan,
  disableAgentHooks,
  enableAgentHooks,
  type HooksPlan,
  planAgentHooks,
} from "./hooksConfig";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const plan: HooksPlan = {
  agent: "codex",
  action: "install",
  path: "/home/me/.codex/hooks.json",
  before: null,
  after: "{}\n",
  changed: true,
};

beforeEach(() => {
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(undefined);
});

describe("hooks configuration commands", () => {
  it("previews with the plan command", async () => {
    native.invoke.mockResolvedValueOnce(plan);
    await expect(planAgentHooks("codex", "install")).resolves.toEqual(plan);
    expect(native.invoke).toHaveBeenCalledWith("agent_hooks_plan", {
      agent: "codex",
      action: "install",
    });
  });

  it("applies a plan against the contents it was computed from", async () => {
    await applyAgentHooksPlan(plan);
    expect(native.invoke).toHaveBeenCalledWith("agent_hooks_apply", {
      agent: "codex",
      action: "install",
      before: null,
    });
  });

  it("enables, disables and reports status", async () => {
    await enableAgentHooks("gemini");
    await disableAgentHooks("gemini");
    native.invoke.mockResolvedValueOnce(true);
    await expect(agentHooksInstalled("gemini")).resolves.toBe(true);
    expect(native.invoke.mock.calls).toEqual([
      ["agent_enable_hooks", { agent: "gemini" }],
      ["agent_disable_hooks", { agent: "gemini" }],
      ["agent_hooks_status", { agent: "gemini" }],
    ]);
  });
});
