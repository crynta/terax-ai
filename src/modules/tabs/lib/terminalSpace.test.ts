import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { spaceIdForLeaf } from "./terminalSpace";

function terminalTab(input: {
  id: number;
  spaceId: string;
  leafId: number;
  cwd?: string;
}): Tab {
  return {
    id: input.id,
    kind: "terminal",
    spaceId: input.spaceId,
    title: "shell",
    cwd: input.cwd,
    paneTree: { kind: "leaf", id: input.leafId, cwd: input.cwd },
    activeLeafId: input.leafId,
  };
}

describe("spaceIdForLeaf", () => {
  it("finds the Space that owns a background terminal leaf", () => {
    const tabs = [
      terminalTab({ id: 1, spaceId: "local", leafId: 10 }),
      terminalTab({ id: 2, spaceId: "wsl", leafId: 20 }),
    ];

    expect(spaceIdForLeaf(tabs, 20)).toBe("wsl");
  });

  it("keeps equal cwd strings distinct by Space ownership", () => {
    const tabs = [
      terminalTab({
        id: 1,
        spaceId: "local",
        leafId: 10,
        cwd: "/workspace",
      }),
      terminalTab({
        id: 2,
        spaceId: "wsl",
        leafId: 20,
        cwd: "/workspace",
      }),
    ];

    expect(spaceIdForLeaf(tabs, 10)).toBe("local");
    expect(spaceIdForLeaf(tabs, 20)).toBe("wsl");
  });

  it("finds a leaf nested in split panes", () => {
    const tabs = [
      {
        ...terminalTab({ id: 1, spaceId: "wsl", leafId: 10 }),
        paneTree: {
          kind: "split" as const,
          id: 11,
          dir: "row" as const,
          children: [
            { kind: "leaf" as const, id: 10 },
            {
              kind: "split" as const,
              id: 12,
              dir: "col" as const,
              children: [
                { kind: "leaf" as const, id: 20 },
                { kind: "leaf" as const, id: 30 },
              ],
            },
          ],
        },
      },
    ];

    expect(spaceIdForLeaf(tabs, 30)).toBe("wsl");
  });

  it("returns null for an unknown leaf", () => {
    expect(
      spaceIdForLeaf(
        [terminalTab({ id: 1, spaceId: "local", leafId: 10 })],
        20,
      ),
    ).toBeNull();
  });
});
