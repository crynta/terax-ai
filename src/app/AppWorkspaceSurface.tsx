import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { AiMiniWindow, SelectionAskAi } from "@/modules/ai/components/lazy";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MarkdownStack } from "@/modules/markdown";
import { PiFloatingWindow } from "@/modules/pi/components/PiFloatingWindow";
import { PiPanel } from "@/modules/pi/PiPanel";
import { PreviewStack } from "@/modules/preview";
import { SidebarPlaceholderPanel } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import { TerminalStack } from "@/modules/terminal";
import { WorkflowStack } from "@/modules/workflow/WorkflowStackLazy";
import { ArtifactWorkspacePanel } from "@/modules/artifacts/ArtifactWorkspacePanel";
import type { CodePanelContext, CodeSurface } from "./codeSurface";

type AppWorkspaceSurfaceProps = {
  activeId: number;
  activeTab: Tab | undefined;
  codePanelContext: CodePanelContext;
  codeSurface: CodeSurface;
  flags: {
    artifact: boolean;
    aiDiff: boolean;
    editor: boolean;
    gitDiff: boolean;
    gitHistory: boolean;
    markdown: boolean;
    piWorkspace: boolean;
    preview: boolean;
    terminal: boolean;
    workflow: boolean;
  };
  tabs: Tab[];
  terminal: Pick<
    ComponentProps<typeof TerminalStack>,
    "onCwd" | "onExit" | "onFocusLeaf" | "onSearchReady" | "registerHandle"
  >;
  editor: Pick<
    ComponentProps<typeof EditorStack>,
    "onCloseTab" | "onDirtyChange" | "registerHandle"
  >;
  preview: Pick<
    ComponentProps<typeof PreviewStack>,
    "onUrlChange" | "registerHandle"
  >;
  aiDiff: Pick<ComponentProps<typeof AiDiffStack>, "onAccept" | "onReject">;
  gitHistory: Pick<
    ComponentProps<typeof GitHistoryStack>,
    "onOpenCommitFile" | "onSearchHandle"
  >;
  workflow: Pick<
    ComponentProps<typeof WorkflowStack>,
    | "onDocumentChange"
    | "onOpenWorkflowPath"
    | "onSaveAsDocument"
    | "onSaveDocument"
    | "recentWorkflowFiles"
  >;
  artifact: {
    onSelectedSlugChange: (tabId: number, slug: string | null) => void;
  };
  pi: Pick<
    ComponentProps<typeof PiPanel>,
    | "focusRequest"
    | "onOpenLocalAgent"
    | "onPopOut"
    | "onSelectedSessionChange"
  >;
};

function surfaceClass(active: boolean, className = "absolute inset-0 px-3 pt-2 pb-2") {
  return cn(className, !active && "invisible pointer-events-none");
}

export function AppWorkspaceSurface({
  activeId,
  activeTab,
  aiDiff,
  artifact,
  codePanelContext,
  codeSurface,
  editor,
  flags,
  gitHistory,
  pi,
  preview,
  tabs,
  terminal,
  workflow,
}: AppWorkspaceSurfaceProps) {
  return (
    <div className="relative h-full min-h-0">
      <div className={surfaceClass(flags.terminal)} aria-hidden={!flags.terminal}>
        <TerminalStack tabs={tabs} activeId={activeId} {...terminal} />
      </div>
      <div className={surfaceClass(flags.editor)} aria-hidden={!flags.editor}>
        <EditorStack tabs={tabs} activeId={activeId} {...editor} />
      </div>
      <div className={surfaceClass(flags.preview)} aria-hidden={!flags.preview}>
        <PreviewStack tabs={tabs} activeId={activeId} {...preview} />
      </div>
      <div className={surfaceClass(flags.markdown)} aria-hidden={!flags.markdown}>
        <MarkdownStack tabs={tabs} activeId={activeId} />
      </div>
      <div className={surfaceClass(flags.aiDiff)} aria-hidden={!flags.aiDiff}>
        <AiDiffStack tabs={tabs} activeId={activeId} {...aiDiff} />
      </div>
      <div className={surfaceClass(flags.gitDiff)} aria-hidden={!flags.gitDiff}>
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={surfaceClass(flags.gitHistory, "absolute inset-0")}
        aria-hidden={!flags.gitHistory}
      >
        <GitHistoryStack tabs={tabs} activeId={activeId} {...gitHistory} />
      </div>
      <div className={surfaceClass(flags.workflow)} aria-hidden={!flags.workflow}>
        <WorkflowStack tabs={tabs} activeId={activeId} {...workflow} />
      </div>
      <div className={surfaceClass(flags.artifact)} aria-hidden={!flags.artifact}>
        {activeTab?.kind === "artifact" ? (
          <ArtifactWorkspacePanel
            conversationId={activeTab.conversationId}
            selectedSlug={activeTab.selectedSlug}
            onSelectedSlugChange={(slug) =>
              artifact.onSelectedSlugChange(activeTab.id, slug)
            }
          />
        ) : null}
      </div>
      <div
        className={surfaceClass(flags.piWorkspace, "absolute inset-0 p-2")}
        aria-hidden={!flags.piWorkspace}
      >
        {codeSurface === "workspace" && flags.piWorkspace ? (
          <PiPanel
            workspaceRoot={codePanelContext.workspaceRoot}
            activeCwd={codePanelContext.activeCwd}
            activeFile={codePanelContext.activeFile}
            activeTerminalPrivate={codePanelContext.activeTerminalPrivate}
            {...pi}
          />
        ) : flags.piWorkspace ? (
          <SidebarPlaceholderPanel
            title="Code"
            description="Code chat is open in another surface."
          />
        ) : null}
      </div>
    </div>
  );
}

export function AppFloatingSurfaces({
  askPopup,
  codePanelContext,
  codeSurface,
  hasComposer,
  miniOpen,
  onAskFromSelection,
  onDismissAskPopup,
  openCodeInSidebar,
  openCodeWorkspace,
  pi,
}: {
  askPopup: { x: number; y: number } | null;
  codePanelContext: CodePanelContext;
  codeSurface: CodeSurface;
  hasComposer: boolean;
  miniOpen: boolean;
  onAskFromSelection: () => void;
  onDismissAskPopup: () => void;
  openCodeInSidebar: () => void;
  openCodeWorkspace: () => void;
  pi: Pick<
    ComponentProps<typeof PiPanel>,
    "focusRequest" | "onOpenLocalAgent" | "onSelectedSessionChange"
  >;
}) {
  return (
    <>
      {codeSurface === "floating" ? (
        <PiFloatingWindow
          key="code-floating"
          onClose={openCodeInSidebar}
          onOpenWorkspace={openCodeWorkspace}
        >
          <PiPanel
            workspaceRoot={codePanelContext.workspaceRoot}
            activeCwd={codePanelContext.activeCwd}
            activeFile={codePanelContext.activeFile}
            activeTerminalPrivate={codePanelContext.activeTerminalPrivate}
            hideHeader
            onOpenWorkspace={openCodeWorkspace}
            {...pi}
          />
        </PiFloatingWindow>
      ) : null}
      {miniOpen && hasComposer ? <AiMiniWindow key="ai-mini" /> : null}
      {askPopup ? (
        <SelectionAskAi
          key="ask-ai-popup"
          x={askPopup.x}
          y={askPopup.y}
          onAsk={onAskFromSelection}
          onDismiss={onDismissAskPopup}
        />
      ) : null}
    </>
  );
}

