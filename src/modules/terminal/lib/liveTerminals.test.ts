import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { selectLiveTerminals } from "./liveTerminals";

function term(id: number, over: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
    ...over,
  } as Tab;
}

describe("selectLiveTerminals", () => {
  it("excludes cold terminals so they never mount or spawn", () => {
    const tabs: Tab[] = [
      term(1, { cold: true }),
      term(2),
      term(3, { cold: true }),
      term(4, { cold: true }),
    ];
    const live = selectLiveTerminals(tabs);
    expect(live.map((t) => t.id)).toEqual([2]);
  });

  it("keeps warm terminals across spaces and ignores non-terminal kinds", () => {
    const tabs: Tab[] = [
      term(1, { spaceId: "a" }),
      term(2, { spaceId: "b" }),
      {
        id: 3,
        kind: "editor",
        spaceId: "a",
        title: "x",
        path: "/x.ts",
        dirty: false,
        preview: false,
        paneTree: { kind: "leaf", id: 4, path: "/x.ts" },
        activeLeafId: 4,
      },
    ];
    expect(selectLiveTerminals(tabs).map((t) => t.id)).toEqual([1, 2]);
  });
});
