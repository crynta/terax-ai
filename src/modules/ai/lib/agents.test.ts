import { describe, expect, it } from "vitest";
import { findAgent, BUILTIN_AGENTS } from "@/modules/ai/lib/agents";

describe("findAgent", () => {
  it("returns the first builtin for null id", () => {
    const agent = findAgent(BUILTIN_AGENTS, null);
    expect(agent.id).toBe("builtin:coder");
    expect(agent.builtIn).toBe(true);
  });

  it("returns the first builtin for undefined id", () => {
    const agent = findAgent(BUILTIN_AGENTS, undefined);
    expect(agent.id).toBe("builtin:coder");
  });

  it("returns matching agent by id", () => {
    const agent = findAgent(BUILTIN_AGENTS, "builtin:architect");
    expect(agent.name).toBe("Architect");
  });

  it("returns first builtin for unknown id", () => {
    const agent = findAgent(BUILTIN_AGENTS, "nonexistent");
    expect(agent.id).toBe("builtin:coder");
  });

  it("finds custom agents in combined list", () => {
    const custom = [
      {
        id: "custom:mine",
        name: "Mine",
        description: "desc",
        instructions: "do stuff",
        icon: "spark" as const,
        builtIn: false,
      },
    ];
    const all = [...BUILTIN_AGENTS, ...custom];
    const agent = findAgent(all, "custom:mine");
    expect(agent.name).toBe("Mine");
    expect(agent.builtIn).toBe(false);
  });
});

describe("BUILTIN_AGENTS", () => {
  it("has 5 built-in agents", () => {
    expect(BUILTIN_AGENTS).toHaveLength(5);
  });

  it("all have valid ids", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.id).toMatch(/^builtin:/);
      expect(a.builtIn).toBe(true);
    }
  });

  it("has non-empty instructions", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.instructions.length).toBeGreaterThan(0);
    }
  });
});
