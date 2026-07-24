import { leafIds } from "@/modules/terminal";
import { describe, expect, it } from "vitest";
import {
  AGENT_LAUNCHERS,
  createAgentPanePlan,
  DEFAULT_AGENT_LAUNCH_COMMANDS,
  normalizeAgentLaunchCommands,
  validateAgentLaunchCommand,
  type AgentInstanceCount,
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
    "creates %i unique leaves with the requested cwd",
    (instances) => {
      const plan = createAgentPanePlan(instances, allocator(), "/workspace");
      const ids = leafIds(plan.paneTree);
      expect(ids).toEqual(plan.leafIds);
      expect(new Set(ids).size).toBe(instances);

      const visit = (node: typeof plan.paneTree) => {
        if (node.kind === "leaf") {
          expect(node.cwd).toBe("/workspace");
          return;
        }
        node.children.forEach(visit);
      };
      visit(plan.paneTree);
    },
  );

  it("balances four agents into a two by two grid", () => {
    const { paneTree } = createAgentPanePlan(4, allocator());
    expect(paneTree.kind).toBe("split");
    if (paneTree.kind !== "split") return;
    expect(paneTree.dir).toBe("row");
    expect(paneTree.children).toHaveLength(2);
    expect(
      paneTree.children.every(
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
