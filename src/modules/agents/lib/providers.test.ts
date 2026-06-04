import { describe, expect, it } from "vitest";
import {
  AGENT_HOOK_TARGETS,
  AGENT_PROVIDERS,
  agentProviderByName,
  agentProviderLabel,
} from "./providers";

describe("agent provider registry", () => {
  it("tracks first class providers in stable UI order", () => {
    expect(AGENT_PROVIDERS.map((provider) => provider.id)).toEqual([
      "terax",
      "pi",
      "claude",
      "codex",
      "cursor",
      "opencode",
      "gemini",
      "antigravity",
    ]);
  });

  it("normalizes common binary names and display labels", () => {
    expect(agentProviderByName("Claude Code")?.id).toBe("claude");
    expect(agentProviderByName("codex")?.id).toBe("codex");
    expect(agentProviderByName("cursor-agent")?.id).toBe("cursor");
    expect(agentProviderByName("opencode")?.id).toBe("opencode");
    expect(agentProviderByName("gemini")?.id).toBe("gemini");
    expect(agentProviderByName("agy")?.id).toBe("antigravity");
    expect(agentProviderLabel("agy")).toBe("Antigravity");
  });

  it("exposes terminal hook targets for hook-capable providers", () => {
    expect(AGENT_HOOK_TARGETS.map((target) => target.id)).toEqual([
      "claude",
      "codex",
      "gemini",
      "antigravity",
    ]);
    expect(AGENT_HOOK_TARGETS.map((target) => target.statusCommand)).toEqual([
      "agent_claude_hooks_status",
      "agent_codex_hooks_status",
      "agent_gemini_hooks_status",
      "agent_antigravity_hooks_status",
    ]);
  });
});
