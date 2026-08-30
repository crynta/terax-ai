import { describe, expect, it } from "vitest";
import type { SpaceRootIssues } from "@/modules/spaces/lib/spaceRoot";
import type { Tab } from "@/modules/tabs";
import { canWarmTab, warmColdTab } from "./tabWarmPolicy";

function terminalTab(input: {
  spaceId: string;
  cold?: boolean;
  cwd?: string;
}): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: input.spaceId,
    cold: input.cold,
    title: "shell",
    cwd: input.cwd,
    paneTree: { kind: "leaf", id: 10, cwd: input.cwd },
    activeLeafId: 10,
  };
}

function editorTab(input: { spaceId: string }): Tab {
  return {
    id: 2,
    kind: "editor",
    spaceId: input.spaceId,
    title: "outside.ts",
    path: "/outside.ts",
    dirty: false,
    preview: false,
  };
}

function brokenIssues(): SpaceRootIssues {
  return { broken: { candidate: "/missing", message: "not found" } };
}

describe("canWarmTab", () => {
  it("keeps a terminal cold while its Space root is unavailable", () => {
    const tab = terminalTab({ spaceId: "broken", cold: true });

    expect(canWarmTab(tab, brokenIssues())).toBe(false);
    expect(warmColdTab(tab, brokenIssues(), { broken: "/rejected" })).toBe(tab);
  });

  it("does not block editor tabs or valid terminal Spaces", () => {
    expect(canWarmTab(editorTab({ spaceId: "broken" }), brokenIssues())).toBe(
      true,
    );
    expect(canWarmTab(terminalTab({ spaceId: "ok" }), brokenIssues())).toBe(
      true,
    );
  });

  it("seeds a recovered Space root before warming a no-cwd fallback", () => {
    const tab = terminalTab({ spaceId: "broken", cold: true });

    expect(warmColdTab(tab, brokenIssues(), { broken: "/rejected" })).toBe(tab);
    expect(warmColdTab(tab, {}, {})).toBe(tab);
    expect(warmColdTab(tab, {}, { broken: "/recovered" })).toMatchObject({
      cold: false,
      cwd: "/recovered",
      paneTree: { kind: "leaf", cwd: "/recovered" },
    });
  });

  it("does not rewrite an existing terminal cwd while warming", () => {
    const tab = terminalTab({
      spaceId: "broken",
      cold: true,
      cwd: "/terminal-local",
    });

    expect(warmColdTab(tab, {}, { broken: "/recovered" })).toMatchObject({
      cold: false,
      cwd: "/terminal-local",
      paneTree: { kind: "leaf", cwd: "/terminal-local" },
    });
  });

  it("leaves a running terminal unchanged while root snapshots change", () => {
    const tab = terminalTab({
      spaceId: "broken",
      cold: false,
      cwd: "/terminal-local",
    });

    expect(warmColdTab(tab, brokenIssues(), { broken: "/rejected" })).toBe(tab);
    expect(warmColdTab(tab, {}, { broken: "/recovered" })).toBe(tab);
  });
});
