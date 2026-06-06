import { invoke } from "@tauri-apps/api/core";
import { type MutableRefObject, useEffect } from "react";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { piLocalAgentHookCommand } from "@/modules/pi/lib/local-agents";
import type { Tab } from "@/modules/tabs";
import {
  findLeafCwd,
  type TerminalPaneHandle,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import type { useAppAiBootstrap } from "./useAppAiBootstrap";

type TuiWaitResult = "ready" | "gone" | "timeout";

type LiveApi = ReturnType<typeof useAppAiBootstrap>["setLive"];

type UseAppManagedAgentsInput = {
  activeId: number;
  explorerRoot: string | null;
  home: string | null;
  launchCwd: string | null;
  newAgentTab: (
    cwd: string | undefined,
    title: string,
  ) => {
    tabId: number;
    leafId: number;
  };
  openPreviewTab: (url: string) => number;
  setLive: LiveApi;
  tabs: Tab[];
  terminalRefs: MutableRefObject<Map<number, TerminalPaneHandle>>;
};

async function waitForClaudeTuiReady(
  readBuf: () => string | null,
  timeoutMs = 8000,
): Promise<TuiWaitResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return "gone";
    if (buf.includes("shortcuts") || buf.includes("? for")) return "ready";
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return "timeout";
}

export function useAppManagedAgents({
  activeId,
  explorerRoot,
  home,
  launchCwd,
  newAgentTab,
  openPreviewTab,
  setLive,
  tabs,
  terminalRefs,
}: UseAppManagedAgentsInput) {
  useEffect(() => {
    const findCwd = () => {
      const active = tabs.find((tab) => tab.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          null
        );
      }
      for (let index = tabs.length - 1; index >= 0; index--) {
        const tab = tabs[index];
        if (tab.kind !== "terminal") continue;
        const cwd = findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd;
        if (cwd) return cwd;
      }
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => {
        const tab = tabs.find((candidate) => candidate.id === activeId);
        if (tab?.kind !== "terminal") return null;
        if (tab.private) return null;
        const buf = terminalRefs.current.get(tab.activeLeafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
      isActiveTerminalPrivate: () => {
        const tab = tabs.find((candidate) => candidate.id === activeId);
        return tab?.kind === "terminal" && tab.private === true;
      },
      injectIntoActivePty: (text) => {
        const tab = tabs.find((candidate) => candidate.id === activeId);
        if (tab?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(tab.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => explorerRoot ?? launchCwd ?? home ?? null,
      getActiveFile: () => {
        const tab = tabs.find((candidate) => candidate.id === activeId);
        return tab?.kind === "editor" ? tab.path : null;
      },
      openPreview: (url: string) => {
        openPreviewTab(url);
        return true;
      },
      spawnManagedAgent: (prompt: string, sessionId: string) => {
        const trimmed = prompt.trim();
        if (!trimmed) return null;
        const oneLine = trimmed.replace(/\s*\r?\n\s*/g, " ");
        const cwd = findCwd();
        const short =
          oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
        const { tabId, leafId } = newAgentTab(
          cwd ?? undefined,
          `claude · ${short}`,
        );
        useManagedAgentsStore
          .getState()
          .register({ leafId, tabId, sessionId, task: oneLine, cwd });
        const hookCommand = piLocalAgentHookCommand("claude");
        const hooksReady = hookCommand
          ? invoke(hookCommand).catch(() => {})
          : Promise.resolve();
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, "claude\r")) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          const readBuf = () => {
            const term = terminalRefs.current.get(leafId);
            return term ? term.getBuffer(120) : null;
          };
          const result = await waitForClaudeTuiReady(readBuf);
          if (result !== "ready") {
            if (result === "timeout") {
              console.warn(
                "[terax] Claude TUI did not appear in time; aborting prompt send",
              );
            }
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          if (!writeToSession(leafId, `\x1b[200~${trimmed}\x1b[201~`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          setTimeout(() => writeToSession(leafId, "\r"), 120);
          useManagedAgentsStore.getState().setPhase(leafId, "working");
        })();
        return { tabId, leafId };
      },
      readLeafBuffer: (leafId: number) => {
        const buf = terminalRefs.current.get(leafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
    });
  }, [
    activeId,
    explorerRoot,
    home,
    launchCwd,
    newAgentTab,
    openPreviewTab,
    setLive,
    tabs,
    terminalRefs,
  ]);
}
