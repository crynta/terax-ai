import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import {
  activeRepositoryContextPath,
  clearRepositoryTargetForSpace,
  gitGraphRepositoryPath,
  repositoryTargetForSpace,
  repositoryTargetIsPending,
  setRepositoryTargetForSpace,
  sourceControlRepositoryPath,
} from "./repositoryTarget";

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  spaceId: "space-a",
  title: "shell",
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
};

const editorTab: Tab = {
  id: 2,
  kind: "editor",
  spaceId: "space-a",
  title: "main.ts",
  path: "C:\\repo\\src\\main.ts",
  dirty: false,
  preview: false,
};

const historyTab: Tab = {
  id: 3,
  kind: "git-history",
  spaceId: "space-a",
  title: "History",
  repoRoot: "/repos/history",
};

describe("repository targets", () => {
  it("keeps fixed repositories isolated by Space", () => {
    const targets = setRepositoryTargetForSpace(
      {},
      "space-a",
      "local",
      "/repos/a",
    );

    expect(repositoryTargetForSpace(targets, "space-a", "local")).toEqual({
      mode: "fixed",
      repoRoot: "/repos/a",
    });
    expect(repositoryTargetForSpace(targets, "space-b", "local")).toEqual({
      mode: "follow-context",
    });
    expect(
      setRepositoryTargetForSpace(
        targets,
        "space-a",
        "local",
        "/repos/a",
      ),
    ).toBe(targets);
  });

  it("keeps repository paths isolated by workspace environment", () => {
    const localTargets = setRepositoryTargetForSpace(
      {},
      "space-a",
      "local",
      "C:/repos/a",
    );
    const targets = setRepositoryTargetForSpace(
      localTargets,
      "space-a",
      "wsl:Ubuntu",
      "/repos/a",
    );

    expect(repositoryTargetForSpace(targets, "space-a", "local")).toEqual({
      mode: "fixed",
      repoRoot: "C:/repos/a",
    });
    expect(repositoryTargetForSpace(targets, "space-a", "wsl:Ubuntu")).toEqual({
      mode: "fixed",
      repoRoot: "/repos/a",
    });
  });

  it("returns to context-following without changing other Spaces", () => {
    const otherSpace = setRepositoryTargetForSpace(
      {},
      "space-b",
      "local",
      "/repos/b",
    );
    const targets = setRepositoryTargetForSpace(
      otherSpace,
      "space-a",
      "local",
      "/repos/a",
    );
    const next = clearRepositoryTargetForSpace(targets, "space-a", "local");

    expect(repositoryTargetForSpace(next, "space-a", "local")).toEqual({
      mode: "follow-context",
    });
    expect(repositoryTargetForSpace(next, "space-b", "local")).toEqual({
      mode: "fixed",
      repoRoot: "/repos/b",
    });
  });
});

describe("activeRepositoryContextPath", () => {
  it("prefers the focused terminal leaf cwd", () => {
    expect(
      activeRepositoryContextPath({
        activeTab: terminalTab,
        activeTerminalLeafCwd: "/repos/terminal/packages/app",
        explorerRoot: "/repos/explorer",
        workspaceFallbackPath: "/fallback",
      }),
    ).toBe("/repos/terminal/packages/app");
  });

  it("uses the editor parent directory across Windows paths", () => {
    expect(
      activeRepositoryContextPath({
        activeTab: editorTab,
        activeTerminalLeafCwd: null,
        explorerRoot: "/repos/explorer",
        workspaceFallbackPath: "/fallback",
      }),
    ).toBe("C:/repo/src");
  });

  it("preserves Unix and Windows filesystem roots", () => {
    expect(
      activeRepositoryContextPath({
        activeTab: { ...editorTab, path: "/main.ts" },
        activeTerminalLeafCwd: null,
        explorerRoot: null,
        workspaceFallbackPath: null,
      }),
    ).toBe("/");
    expect(
      activeRepositoryContextPath({
        activeTab: { ...editorTab, path: "C:\\main.ts" },
        activeTerminalLeafCwd: null,
        explorerRoot: null,
        workspaceFallbackPath: null,
      }),
    ).toBe("C:/");
  });

  it("keeps a Git tab bound to its own repository", () => {
    expect(
      activeRepositoryContextPath({
        activeTab: historyTab,
        activeTerminalLeafCwd: null,
        explorerRoot: "/repos/explorer",
        workspaceFallbackPath: "/fallback",
      }),
    ).toBe("/repos/history");
  });
});

describe("sourceControlRepositoryPath", () => {
  const fixed = { mode: "fixed", repoRoot: "/repos/fixed" } as const;

  it("applies a fixed target inside Source Control", () => {
    expect(
      sourceControlRepositoryPath({
        contextPath: "/repos/active",
        badgeContextPath: "/repos/explorer",
        sidebarView: "source-control",
        hasOpenGitTab: false,
        target: fixed,
      }),
    ).toBe("/repos/fixed");
  });

  it("does not leak a fixed target into Explorer decorations or badges", () => {
    expect(
      sourceControlRepositoryPath({
        contextPath: "/repos/active",
        badgeContextPath: "/repos/explorer",
        sidebarView: "explorer",
        hasOpenGitTab: false,
        target: fixed,
      }),
    ).toBe("/repos/explorer");
  });

  it("keeps open Git tabs on their active repository outside Source Control", () => {
    expect(
      sourceControlRepositoryPath({
        contextPath: "/repos/history",
        badgeContextPath: "/repos/explorer",
        sidebarView: "explorer",
        hasOpenGitTab: true,
        target: fixed,
      }),
    ).toBe("/repos/history");
  });

  it("uses the fixed target for graph routing only from Source Control", () => {
    expect(
      gitGraphRepositoryPath({
        contextPath: "/repos/active",
        sidebarView: "source-control",
        target: fixed,
      }),
    ).toBe("/repos/fixed");
    expect(
      gitGraphRepositoryPath({
        contextPath: "/repos/active",
        sidebarView: "explorer",
        target: fixed,
      }),
    ).toBe("/repos/active");
  });
});

describe("repositoryTargetIsPending", () => {
  const fixed = { mode: "fixed", repoRoot: "/repos/fixed" } as const;

  it("masks state loaded for a previous repository", () => {
    expect(
      repositoryTargetIsPending({
        target: fixed,
        loadedContextPath: "/repos/previous",
        loadedRepoRoot: "/repos/previous",
        isLoading: false,
      }),
    ).toBe(true);
  });

  it("keeps loading masked until the selected repository is loaded", () => {
    expect(
      repositoryTargetIsPending({
        target: fixed,
        loadedContextPath: "/repos/fixed",
        loadedRepoRoot: null,
        isLoading: true,
      }),
    ).toBe(true);
  });

  it("reveals a completed error or no-repository state", () => {
    expect(
      repositoryTargetIsPending({
        target: fixed,
        loadedContextPath: "/repos/fixed",
        loadedRepoRoot: null,
        isLoading: false,
      }),
    ).toBe(false);
  });
});
