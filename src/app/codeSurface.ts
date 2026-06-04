import type { SecondarySidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";

export type CodeSurface = "sidebar" | "floating" | "workspace";

export type CodePanelContext = {
  workspaceRoot: string | null;
  activeCwd: string | null;
  activeFile: string | null;
  activeTerminalPrivate: boolean;
};

type CodePanelMountInput = {
  surface: CodeSurface;
  secondarySidebarView: SecondarySidebarViewId;
  secondarySidebarVisible: boolean;
  activeTabKind: Tab["kind"] | null | undefined;
};

export function codePanelMounts(input: CodePanelMountInput) {
  return {
    sidebar:
      input.surface === "sidebar" &&
      input.secondarySidebarView === "code" &&
      input.secondarySidebarVisible,
    floating: input.surface === "floating",
    workspace:
      input.surface === "workspace" && input.activeTabKind === "pi-workspace",
  };
}

export function resolveCodeSurfaceAfterWorkspaceClose(
  surface: CodeSurface,
  hasPiWorkspaceTab: boolean,
): CodeSurface {
  return surface === "workspace" && !hasPiWorkspaceTab ? "sidebar" : surface;
}

export function piSessionActivationPlan(surface: CodeSurface): {
  openSidebar: boolean;
  openWorkspace: boolean;
} {
  return {
    openSidebar: surface === "sidebar",
    openWorkspace: surface === "workspace",
  };
}

export function shouldCollapseSecondarySidebarForCodeMove(
  secondarySidebarView: SecondarySidebarViewId,
  targetSurface: CodeSurface,
): boolean {
  return secondarySidebarView === "code" && targetSurface !== "sidebar";
}

export function surfaceForSecondarySidebarSelection(
  view: SecondarySidebarViewId,
): CodeSurface | null {
  return view === "code" ? "sidebar" : null;
}

export function resolveCodeContext(input: {
  surface: CodeSurface;
  activeContext: CodePanelContext;
  capturedContext: CodePanelContext | null;
}): CodePanelContext {
  if (input.surface === "workspace" && input.capturedContext !== null) {
    return input.capturedContext;
  }
  return input.activeContext;
}
