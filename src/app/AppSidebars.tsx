import type { ReactNode, RefObject } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import { InboxPanel } from "@/modules/inbox/components/InboxPanelLazy";
import {
  type InboxRow,
  type InboxUnreadCounts,
} from "@/modules/inbox/lib/model";
import { ModelComparePanel } from "@/modules/model-compare/ModelComparePanelLazy";
import type { PiLocalAgentLaunchRequest } from "@/modules/pi/lib/local-agents";
import type { PiChatFocusRequest } from "@/modules/pi/PiChatPanel";
import { PiChatPanel } from "@/modules/pi/PiChatPanel";
import { type PiFocusRequest, PiPanel } from "@/modules/pi/PiPanel";
import {
  PRIMARY_SIDEBAR_VIEW_ITEMS,
  type PrimarySidebarViewId,
  SECONDARY_SIDEBAR_VIEW_ITEMS,
  type SecondarySidebarViewId,
  SidebarLayoutShell,
  SidebarPlaceholderPanel,
  type SidebarPosition,
} from "@/modules/sidebar";
import {
  SourceControlPanel,
  type SourceControlSummary,
} from "@/modules/source-control";
import type { CodePanelContext, CodeSurface } from "./codeSurface";

type OpenGitDiffInput = {
  path: string;
  repoRoot: string;
  mode: "+" | "-";
  originalPath: string | null;
  title?: string;
};

type PrimarySidebarProps = {
  activeFilePath?: string | null;
  activeView: PrimarySidebarViewId;
  defaultSize: number;
  explorerRef: RefObject<FileExplorerHandle | null>;
  rootPath: string | null;
  sourceControl: SourceControlSummary;
  visible: boolean;
  widthRef: RefObject<PanelImperativeHandle | null>;
  onAttachFileToAgent: (path: string) => void;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenGitDiff: (input: OpenGitDiffInput) => void;
  onOpenGitGraph: () => void;
  onOpenMarkdownPreview: (path: string) => void;
  onPathDeleted: (path: string) => void;
  onPathRenamed: (from: string, to: string) => void;
  onResize: (sizeInPixels: number) => void;
  onRevealInTerminal: (path: string) => void;
  onSelectView: (view: PrimarySidebarViewId) => void;
};

type SecondarySidebarProps = {
  activeView: SecondarySidebarViewId;
  chatContext: CodePanelContext;
  chatFocusRequest: PiChatFocusRequest | null;
  codeContext: CodePanelContext;
  codeSurface: CodeSurface;
  defaultSize: number;
  inboxRows: readonly InboxRow[];
  unreadCounts: InboxUnreadCounts;
  visible: boolean;
  widthRef: RefObject<PanelImperativeHandle | null>;
  piFocusRequest: PiFocusRequest | null;
  onClearReadInboxRows: () => void;
  onCodeSelectedSessionChange: (sessionId: string | null) => void;
  onMarkInboxRowsRead: (rowIds: readonly string[]) => void;
  onOpenArtifactWorkspace: (sessionId: string, slug?: string | null) => void;
  onOpenCodePopOut: () => void;
  onOpenCodeWorkspace: () => void;
  onOpenInboxRow: (row: InboxRow) => void;
  onOpenLocalAgent: (request: PiLocalAgentLaunchRequest) => void;
  onResize: (sizeInPixels: number) => void;
  onSelectView: (view: SecondarySidebarViewId) => void;
  onChatSelectedSessionChange: (sessionId: string | null) => void;
};

type AppSidebarsProps = {
  primary: PrimarySidebarProps;
  secondary: SecondarySidebarProps;
  sidebarPosition: SidebarPosition;
  workspace: ReactNode;
};

export function AppSidebars({
  primary,
  secondary,
  sidebarPosition,
  workspace,
}: AppSidebarsProps) {
  const renderPrimaryPanelContent = () =>
    primary.activeView === "explorer" ? (
      <FileExplorer
        ref={primary.explorerRef}
        rootPath={primary.rootPath}
        activeFilePath={primary.activeFilePath}
        onOpenFile={primary.onOpenFile}
        onPathRenamed={primary.onPathRenamed}
        onPathDeleted={primary.onPathDeleted}
        onRevealInTerminal={primary.onRevealInTerminal}
        onAttachToAgent={primary.onAttachFileToAgent}
        onOpenMarkdownPreview={primary.onOpenMarkdownPreview}
      />
    ) : (
      <SourceControlPanel
        open
        sourceControl={primary.sourceControl}
        onOpenDiff={primary.onOpenGitDiff}
        onOpenGitGraph={primary.onOpenGitGraph}
        onOpenFile={primary.onOpenFile}
      />
    );

  const renderSecondaryPanelContent = () => {
    if (secondary.activeView === "code") {
      if (secondary.codeSurface !== "sidebar") {
        return (
          <SidebarPlaceholderPanel
            title="Code"
            description="Code chat is open in another surface."
          />
        );
      }
      if (!secondary.visible) return null;
      return (
        <PiPanel
          workspaceRoot={secondary.codeContext.workspaceRoot}
          activeCwd={secondary.codeContext.activeCwd}
          activeFile={secondary.codeContext.activeFile}
          activeTerminalPrivate={secondary.codeContext.activeTerminalPrivate}
          focusRequest={secondary.piFocusRequest}
          onOpenLocalAgent={secondary.onOpenLocalAgent}
          onOpenWorkspace={secondary.onOpenCodeWorkspace}
          onPopOut={secondary.onOpenCodePopOut}
          onSelectedSessionChange={secondary.onCodeSelectedSessionChange}
        />
      );
    }

    if (secondary.activeView === "chat") {
      return (
        <PiChatPanel
          workspaceRoot={secondary.chatContext.workspaceRoot}
          activeCwd={secondary.chatContext.activeCwd}
          activeFile={secondary.chatContext.activeFile}
          activeTerminalPrivate={secondary.chatContext.activeTerminalPrivate}
          focusRequest={secondary.chatFocusRequest}
          onOpenArtifacts={secondary.onOpenArtifactWorkspace}
          onSelectedSessionChange={secondary.onChatSelectedSessionChange}
        />
      );
    }

    if (secondary.activeView === "compare") {
      return (
        <ModelComparePanel
          activeCwd={secondary.codeContext.activeCwd}
          workspaceRoot={secondary.codeContext.workspaceRoot}
          onOpenArtifactWorkspace={secondary.onOpenArtifactWorkspace}
        />
      );
    }

    return (
      <InboxPanel
        rows={secondary.inboxRows}
        onClearRead={secondary.onClearReadInboxRows}
        onMarkRead={secondary.onMarkInboxRowsRead}
        onOpenRow={secondary.onOpenInboxRow}
      />
    );
  };

  return (
    <SidebarLayoutShell
      primary={{
        activeView: primary.activeView,
        badges: {
          "source-control": primary.sourceControl.changedCount,
        },
        defaultSize: primary.defaultSize,
        items: PRIMARY_SIDEBAR_VIEW_ITEMS,
        panelRef: primary.widthRef,
        renderContent: renderPrimaryPanelContent,
        visible: primary.visible,
        onResize: primary.onResize,
        onSelectView: primary.onSelectView,
      }}
      secondary={{
        activeView: secondary.activeView,
        badges: {
          chat: secondary.unreadCounts.chat,
          code: secondary.unreadCounts.code,
          inbox: secondary.unreadCounts.inbox,
        },
        defaultSize: secondary.defaultSize,
        items: SECONDARY_SIDEBAR_VIEW_ITEMS,
        panelRef: secondary.widthRef,
        renderContent: renderSecondaryPanelContent,
        visible: secondary.visible,
        onResize: secondary.onResize,
        onSelectView: secondary.onSelectView,
      }}
      sidebarPosition={sidebarPosition}
      workspace={workspace}
    />
  );
}
