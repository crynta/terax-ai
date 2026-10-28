import { describe, expect, it } from "vitest";
import type { SidebarViewId } from "@/modules/sidebar";
import { isGitTabKind, isStatusLive, statusConsumers } from "./statusConsumers";

const base = {
  sidebarCollapsed: false,
  sidebarView: "explorer" as SidebarViewId,
  activeTabKind: "terminal" as string | undefined,
  explorerGitDecorations: false,
};
const live = (over: Partial<typeof base>) =>
  isStatusLive(statusConsumers({ ...base, ...over }));

describe("statusConsumers", () => {
  it("is idle when nothing that shows git state is on screen", () => {
    expect(live({})).toBe(false);
    expect(live({ activeTabKind: "editor" })).toBe(false);
    expect(live({ activeTabKind: undefined })).toBe(false);
  });

  it("goes live for the Source Control panel only while the sidebar is expanded", () => {
    expect(live({ sidebarView: "source-control" })).toBe(true);
    expect(
      live({ sidebarView: "source-control", sidebarCollapsed: true }),
    ).toBe(false);
  });

  it("goes live for a visible git tab even with the sidebar collapsed", () => {
    for (const kind of ["git-diff", "git-history", "git-commit-file"]) {
      expect(live({ activeTabKind: kind, sidebarCollapsed: true })).toBe(true);
    }
    expect(isGitTabKind("ai-diff")).toBe(false);
    expect(isGitTabKind("terminal")).toBe(false);
  });

  it("treats explorer decorations as a consumer only while the explorer is on screen", () => {
    expect(live({ explorerGitDecorations: true })).toBe(true);
    expect(live({ explorerGitDecorations: true, sidebarCollapsed: true })).toBe(
      false,
    );
    // Source Control replaces the explorer in the sidebar: no decorations drawn.
    expect(
      statusConsumers({
        ...base,
        sidebarView: "source-control",
        explorerGitDecorations: true,
      }).explorerDecorations,
    ).toBe(false);
  });

  it("does not count the rail badge as a consumer", () => {
    // Explorer open, decorations off, plain terminal tab: only the badge is
    // visible, and the badge refreshes lazily instead of on every focus.
    expect(statusConsumers({ ...base, explorerGitDecorations: false })).toEqual(
      { panel: false, gitTab: false, explorerDecorations: false },
    );
  });
});
