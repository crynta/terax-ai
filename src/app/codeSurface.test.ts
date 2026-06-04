import { describe, expect, it } from "vitest";
import {
  type CodePanelContext,
  codePanelMounts,
  piSessionActivationPlan,
  resolveCodeContext,
  resolveCodeSurfaceAfterWorkspaceClose,
  shouldCollapseSecondarySidebarForCodeMove,
  surfaceForSecondarySidebarSelection,
} from "./codeSurface";

const context = (
  overrides: Partial<CodePanelContext> = {},
): CodePanelContext => ({
  workspaceRoot: "/repo",
  activeCwd: "/repo",
  activeFile: null,
  activeTerminalPrivate: false,
  ...overrides,
});

describe("Code surface app behavior", () => {
  it("renders exactly one live Code panel for sidebar, floating, and workspace surfaces", () => {
    expect(
      codePanelMounts({
        surface: "sidebar",
        secondarySidebarView: "code",
        secondarySidebarVisible: true,
        activeTabKind: "terminal",
      }),
    ).toEqual({ sidebar: true, floating: false, workspace: false });

    expect(
      codePanelMounts({
        surface: "floating",
        secondarySidebarView: "code",
        secondarySidebarVisible: true,
        activeTabKind: "terminal",
      }),
    ).toEqual({ sidebar: false, floating: true, workspace: false });

    expect(
      codePanelMounts({
        surface: "workspace",
        secondarySidebarView: "code",
        secondarySidebarVisible: true,
        activeTabKind: "pi-workspace",
      }),
    ).toEqual({ sidebar: false, floating: false, workspace: true });
  });

  it("falls back to sidebar surface when the pi-workspace tab is closed", () => {
    expect(resolveCodeSurfaceAfterWorkspaceClose("workspace", false)).toBe(
      "sidebar",
    );
    expect(resolveCodeSurfaceAfterWorkspaceClose("workspace", true)).toBe(
      "workspace",
    );
    expect(resolveCodeSurfaceAfterWorkspaceClose("floating", false)).toBe(
      "floating",
    );
  });

  it("plans notification activation without changing a floating Code surface", () => {
    expect(piSessionActivationPlan("floating")).toEqual({
      openSidebar: false,
      openWorkspace: false,
    });
    expect(piSessionActivationPlan("workspace")).toEqual({
      openSidebar: false,
      openWorkspace: true,
    });
    expect(piSessionActivationPlan("sidebar")).toEqual({
      openSidebar: true,
      openWorkspace: false,
    });
  });

  it("collapses the Code sidebar when moving Code to floating or workspace", () => {
    expect(shouldCollapseSecondarySidebarForCodeMove("code", "floating")).toBe(
      true,
    );
    expect(shouldCollapseSecondarySidebarForCodeMove("code", "workspace")).toBe(
      true,
    );
    expect(shouldCollapseSecondarySidebarForCodeMove("code", "sidebar")).toBe(
      false,
    );
    expect(shouldCollapseSecondarySidebarForCodeMove("chat", "floating")).toBe(
      false,
    );
  });

  it("switches back to sidebar surface when the Code rail item is selected", () => {
    expect(surfaceForSecondarySidebarSelection("code")).toBe("sidebar");
    expect(surfaceForSecondarySidebarSelection("chat")).toBeNull();
  });

  it("uses the captured terminal or file context while Code is in workspace", () => {
    const captured = context({
      activeFile: "/repo/src/App.tsx",
      activeTerminalPrivate: true,
    });
    const workspaceTabContext = context({
      activeCwd: "/repo",
      activeFile: null,
      activeTerminalPrivate: false,
    });

    expect(
      resolveCodeContext({
        surface: "workspace",
        activeContext: workspaceTabContext,
        capturedContext: captured,
      }),
    ).toEqual(captured);
  });

  it("uses live context outside workspace so sidebar follows the active tab", () => {
    const captured = context({ activeFile: "/repo/old.ts" });
    const active = context({ activeFile: "/repo/new.ts" });

    expect(
      resolveCodeContext({
        surface: "sidebar",
        activeContext: active,
        capturedContext: captured,
      }),
    ).toEqual(active);
  });
});
