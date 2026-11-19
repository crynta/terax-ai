import { cards } from "@/modules/workbench/model/layout";
import { describe, expect, it } from "vitest";
import {
  AGENT_LAUNCHERS,
  type AgentInstanceCount,
  createAgentPanePlan,
  DEFAULT_AGENT_LAUNCH_COMMANDS,
  normalizeAgentLaunchCommands,
  validateAgentLaunchCommand,
} from "./launcher";

function allocator(start = 1) {
  let id = start;
  return () => id++;
}

describe("agent launch commands", () => {
  it("defines a non-empty default for every launcher", () => {
    for (const launcher of AGENT_LAUNCHERS) {
      expect(DEFAULT_AGENT_LAUNCH_COMMANDS[launcher.id]).toBe(
        launcher.defaultCommand,
      );
    }
  });

  it("accepts aliases and arguments while trimming whitespace", () => {
    expect(validateAgentLaunchCommand("  cc --model opus  ")).toEqual({
      ok: true,
      command: "cc --model opus",
    });
  });

  it("rejects blank, multiline, and oversized commands", () => {
    expect(validateAgentLaunchCommand(" ")).toMatchObject({ ok: false });
    expect(validateAgentLaunchCommand("codex\nwhoami")).toMatchObject({
      ok: false,
    });
    expect(validateAgentLaunchCommand("x".repeat(257))).toMatchObject({
      ok: false,
    });
  });

  it("falls back per agent when persisted preferences are malformed", () => {
    expect(
      normalizeAgentLaunchCommands({
        claude: "cc",
        codex: "",
        gemini: 42,
        pi: "pi --provider local",
        unknown: "ignored",
      }),
    ).toEqual({
      claude: "cc",
      codex: "codex",
      gemini: "gemini",
      pi: "pi --provider local",
      opencode: "opencode",
      grok: "grok",
    });
  });
});

describe("createAgentPanePlan", () => {
  it.each([1, 2, 3, 4] as AgentInstanceCount[])(
    "creates %i cards, one unique terminal each",
    (instances) => {
      const plan = createAgentPanePlan(instances, allocator());
      const all = cards(plan.layout);
      expect(all).toHaveLength(instances);
      expect(all.map((c) => c.tabIds)).toEqual(plan.leafIds.map((id) => [id]));
      expect(new Set(plan.leafIds).size).toBe(instances);
      expect(plan.focusedCardId).toBe(all[0].id);
    },
  );

  it("balances four agents into a two by two grid", () => {
    const { layout } = createAgentPanePlan(4, allocator());
    expect(layout.kind).toBe("split");
    if (layout.kind !== "split") return;
    expect(layout.dir).toBe("row");
    expect(layout.children).toHaveLength(2);
    expect(
      layout.children.every(
        (child) =>
          child.kind === "split" &&
          child.dir === "col" &&
          child.children.length === 2,
      ),
    ).toBe(true);
  });

  it("rejects counts outside the renderer pool limit", () => {
    expect(() =>
      createAgentPanePlan(0 as AgentInstanceCount, allocator()),
    ).toThrow(RangeError);
    expect(() =>
      createAgentPanePlan(5 as AgentInstanceCount, allocator()),
    ).toThrow(RangeError);
  });
});
