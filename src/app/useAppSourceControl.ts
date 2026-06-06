import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo } from "react";
import { native } from "@/modules/ai/lib/native";
import {
  piLocalAgentHookCommand,
  type PiLocalAgentLaunchRequest,
} from "@/modules/pi/lib/local-agents";
import { useSourceControl } from "@/modules/source-control";
import type { Tab } from "@/modules/tabs";
import { whenSessionReady, writeToSession } from "@/modules/terminal";

type UseAppSourceControlInput = {
  activeTab: Tab | undefined;
  activeTerminalLeafCwd: string | null;
  cycleSidebarView: (view: "source-control") => void;
  disposeTab: (id: number) => void;
  explorerRoot: string | null;
  newAgentTab: (
    cwd: string | undefined,
    title: string,
  ) => { tabId: number; leafId: number };
  openCommitHistoryTab: (input: {
    repoRoot: string;
    branch: string | null;
  }) => number;
  sidebarView: string;
  tabs: Tab[];
  workspaceFallbackPath: string | null;
};

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function sourceControlContextPath({
  activeTab,
  activeTerminalLeafCwd,
  explorerRoot,
  workspaceFallbackPath,
}: Pick<
  UseAppSourceControlInput,
  | "activeTab"
  | "activeTerminalLeafCwd"
  | "explorerRoot"
  | "workspaceFallbackPath"
>): string | null {
  if (activeTab?.kind === "terminal") {
    return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
  }
  if (activeTab?.kind === "editor") return dirname(activeTab.path);
  if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
  if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
  if (activeTab?.kind === "git-history") return activeTab.repoRoot;
  return explorerRoot ?? workspaceFallbackPath;
}

export function useAppSourceControl({
  activeTab,
  activeTerminalLeafCwd,
  cycleSidebarView,
  disposeTab,
  explorerRoot,
  newAgentTab,
  openCommitHistoryTab,
  sidebarView,
  tabs,
  workspaceFallbackPath,
}: UseAppSourceControlInput) {
  const contextPath = sourceControlContextPath({
    activeTab,
    activeTerminalLeafCwd,
    explorerRoot,
    workspaceFallbackPath,
  });
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (tab) =>
          tab.kind === "git-diff" ||
          tab.kind === "git-history" ||
          tab.kind === "git-commit-file",
      ),
    [tabs],
  );
  const active = hasOpenGitTab || sidebarView === "source-control";
  // Stable per-session path so switching tabs / cd-ing in a shell does NOT
  // re-fire git IPC for the badge. The active panel resolves the current
  // context path on its own when the user actually opens git.
  const sourceControl = useSourceControl(
    active ? contextPath : workspaceFallbackPath,
    true,
  );

  const launchPiLocalAgent = useCallback(
    (request: PiLocalAgentLaunchRequest) => {
      const cwd =
        activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
      const launchLabel = request.prompt ? "prompt" : "plan";
      const { tabId, leafId } = newAgentTab(
        cwd ?? undefined,
        `${request.label} · ${launchLabel}`,
      );
      const hookCommand = piLocalAgentHookCommand(request.id);
      const hooksReady = hookCommand
        ? invoke(hookCommand).catch((error) => {
            console.warn(
              `[terax] Failed to enable ${request.label} terminal hooks`,
              error,
            );
          })
        : Promise.resolve();
      void (async () => {
        try {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, `${request.command}\r`)) {
            console.warn(
              `[terax] Failed to launch ${request.label}: terminal was not writable`,
            );
            disposeTab(tabId);
          }
        } catch (error) {
          console.warn(`[terax] Failed to launch ${request.label}`, error);
          disposeTab(tabId);
        }
      })();
    },
    [
      activeTerminalLeafCwd,
      disposeTab,
      explorerRoot,
      newAgentTab,
      workspaceFallbackPath,
    ],
  );

  const toggleSourceControl = useCallback(() => {
    cycleSidebarView("source-control");
  }, [cycleSidebarView]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!contextPath) return;
    try {
      const repo = await native.gitResolveRepo(contextPath);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      // noop
    }
  }, [
    contextPath,
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
  ]);

  return {
    launchPiLocalAgent,
    openGitGraphFromContext,
    sourceControl,
    sourceControlContextPath: contextPath,
    toggleSourceControl,
  };
}
