import { describe, expect, it } from "vitest";
import {
  planFileTabOpen,
  type EditorTab,
  type Tab,
  type TerminalTab,
} from "./useTabs";

const terminal: TerminalTab = {
  id: 1,
  kind: "terminal",
  spaceId: "one",
  title: "shell",
  paneTree: { kind: "leaf", id: 2 },
  activeLeafId: 2,
};

function editor(
  id: number,
  path: string,
  spaceId: string,
  preview: boolean,
): EditorTab {
  return {
    id,
    kind: "editor",
    spaceId,
    title: path,
    path,
    dirty: false,
    preview,
  };
}

describe("planFileTabOpen", () => {
  it("returns the allocated tab id synchronously for line targeting", () => {
    const plan = planFileTabOpen(
      [terminal],
      "/repo/main.rs",
      true,
      "one",
      () => 3,
    );

    expect(plan.tabId).toBe(3);
    expect(plan.tabs[plan.tabs.length - 1]).toMatchObject({
      id: 3,
      kind: "editor",
      path: "/repo/main.rs",
      spaceId: "one",
      preview: false,
    });
  });

  it("reuses files only within the requested space", () => {
    const tabs: Tab[] = [
      terminal,
      editor(3, "/repo/main.rs", "one", false),
      editor(4, "/repo/main.rs", "two", false),
    ];

    const plan = planFileTabOpen(tabs, "/repo/main.rs", true, "two", () => 5);

    expect(plan.tabId).toBe(4);
    expect(plan.tabs).toBe(tabs);
  });

  it("replaces only the target space preview slot", () => {
    const otherPreview = editor(3, "/other/old.ts", "two", true);
    const tabs: Tab[] = [
      terminal,
      editor(4, "/repo/old.ts", "one", true),
      otherPreview,
    ];

    const plan = planFileTabOpen(tabs, "/repo/new.ts", false, "one", () => 5);

    expect(plan.tabId).toBe(5);
    expect(plan.tabs).toContain(otherPreview);
    expect(plan.tabs).toContainEqual(
      expect.objectContaining({
        id: 5,
        path: "/repo/new.ts",
        spaceId: "one",
        preview: true,
      }),
    );
  });
});
