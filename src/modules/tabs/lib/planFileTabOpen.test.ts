import { describe, expect, it } from "vitest";
import {
  type EditorTab,
  planFileTabOpen,
  planMarkdownTabOpen,
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

  it("promotes an existing preview only in the requested space", () => {
    const preview = editor(3, "/repo/main.rs", "one", true);
    const otherPreview = editor(4, "/repo/main.rs", "two", true);
    const tabs: Tab[] = [terminal, preview, otherPreview];

    const plan = planFileTabOpen(tabs, "/repo/main.rs", true, "one", () => 5);

    expect(plan.tabId).toBe(3);
    expect(plan.tabs).not.toBe(tabs);
    expect(plan.tabs).toContainEqual(
      expect.objectContaining({ id: 3, preview: false }),
    );
    expect(plan.tabs).toContain(otherPreview);
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

describe("planMarkdownTabOpen", () => {
  it("reuses markdown tabs only within the requested space", () => {
    const tabs: Tab[] = [
      terminal,
      {
        id: 3,
        kind: "markdown",
        spaceId: "two",
        title: "README.md",
        path: "/repo/README.md",
      },
    ];

    const reused = planMarkdownTabOpen(tabs, "/repo/README.md", "two", () => {
      throw new Error("should not allocate");
    });
    const plan = planMarkdownTabOpen(tabs, "/repo/README.md", "one", () => 4);

    expect(reused).toEqual({ tabs, tabId: 3 });
    expect(plan.tabId).toBe(4);
    expect(plan.tabs).toContainEqual(
      expect.objectContaining({
        id: 4,
        kind: "markdown",
        path: "/repo/README.md",
        spaceId: "one",
      }),
    );
    expect(plan.tabs).toContain(tabs[1]);
  });

  it("preserves markdown and regular files in a mixed launch batch", () => {
    const markdownPlan = planMarkdownTabOpen(
      [terminal],
      "/repo/README.md",
      "one",
      () => 3,
    );
    const filePlan = planFileTabOpen(
      markdownPlan.tabs,
      "/repo/main.rs",
      true,
      "one",
      () => 4,
    );

    expect(filePlan.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "markdown",
          path: "/repo/README.md",
        }),
        expect.objectContaining({ kind: "editor", path: "/repo/main.rs" }),
      ]),
    );
  });

  it("normalizes path separators when reusing a markdown tab", () => {
    const tabs: Tab[] = [
      terminal,
      {
        id: 3,
        kind: "markdown",
        spaceId: "one",
        title: "README.md",
        path: "C:\\repo\\README.md",
      },
    ];

    const plan = planMarkdownTabOpen(tabs, "C:/repo/README.md", "one", () => {
      throw new Error("should not allocate");
    });

    expect(plan).toEqual({ tabs, tabId: 3 });
  });
});
