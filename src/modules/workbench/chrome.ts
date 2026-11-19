import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import { createContext, useContext } from "react";

/** App-level flows the card chrome needs (confirmation dialogs, launchers). */
export type WorkbenchChrome = {
  /** Closes one tab, asking first when it holds unsaved or running work. */
  closeTab: (id: number) => void;
  /** Closes several tabs of one card with one confirmation. */
  closeTabs: (
    kind: "right" | "other" | "card",
    anchorId: number,
    ids: number[],
  ) => void;
  newEditor: () => void;
  newGitGraph: () => void;
  launchAgents: (request: AgentLaunchRequest) => void;
  /** Directory a new terminal starts in. */
  newTerminalCwd: () => string | undefined;
};

const noop = () => {};

export const WorkbenchChromeContext = createContext<WorkbenchChrome>({
  closeTab: noop,
  closeTabs: noop,
  newEditor: noop,
  newGitGraph: noop,
  launchAgents: noop,
  newTerminalCwd: () => undefined,
});

export function useWorkbenchChrome(): WorkbenchChrome {
  return useContext(WorkbenchChromeContext);
}
