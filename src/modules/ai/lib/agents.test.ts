import { describe, expect, it } from "vitest";
import { type Agent, BUILTIN_AGENTS, findAgent } from "./agents";

const custom: Agent = {
  id: "a-1",
  name: "Mine",
  description: "",
  instructions: "",
  icon: "spark",
  builtIn: false,
};

const all = [...BUILTIN_AGENTS, custom];

describe("BUILTIN_AGENTS", () => {
  it("all carry unique ids and the builtIn flag", () => {
    const ids = BUILTIN_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_AGENTS.every((a) => a.builtIn)).toBe(true);
  });
});

describe("findAgent", () => {
  it("returns the agent whose id matches", () => {
    expect(findAgent(all, "a-1")).toBe(custom);
  });

  it("falls back to the first builtin for a missing id", () => {
    expect(findAgent(all, "does-not-exist")).toBe(BUILTIN_AGENTS[0]);
  });

  it("falls back to the first builtin for null, undefined, or empty id", () => {
    expect(findAgent(all, null)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, undefined)).toBe(BUILTIN_AGENTS[0]);
    expect(findAgent(all, "")).toBe(BUILTIN_AGENTS[0]);
  });
});
