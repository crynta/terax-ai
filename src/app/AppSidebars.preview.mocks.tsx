import { useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { InboxRow } from "@/modules/inbox/lib/model";
import { AppSidebars } from "./AppSidebars";
import type {
  FileExplorerHandle,
  SourceControlSummary,
} from "./AppSidebars.preview.panels";

type PrimaryViewId = "explorer" | "source-control";
type SecondaryViewId = "code" | "chat" | "compare" | "inbox";
type SidebarPosition = "left" | "right";
type CodeSurface = "sidebar" | "floating" | "workspace";

export type AppSidebarsPreviewArgs = {
  primaryView?: PrimaryViewId;
  secondaryView?: SecondaryViewId;
  sidebarPosition?: SidebarPosition;
  codeSurface?: CodeSurface;
  changedCount?: number;
  unreadChat?: number;
  unreadCode?: number;
  unreadInbox?: number;
  inboxItemCount?: number;
  primaryVisible?: boolean;
  secondaryVisible?: boolean;
  workspaceLabel?: string;
  resolvedTheme?: "light" | "dark";
};

const PREVIEW_ROOT = "/preview/repo";
const PREVIEW_CWD = `${PREVIEW_ROOT}/src`;
const PREVIEW_FILE = `${PREVIEW_CWD}/app/AppSidebars.tsx`;

const PREVIEW_INBOX_ROWS: readonly InboxRow[] = [
  {
    id: "inbox-preview-1",
    title: "Pi session ready",
    body: "Agent finished indexing the workspace.",
    at: 1_704_067_200_000,
    read: false,
    scope: "chat",
    sessionTitle: "Workspace bootstrap",
    action: { type: "open-pi-session", sessionId: "pi-preview-1" },
  },
  {
    id: "inbox-preview-2",
    title: "Artifact updated",
    body: "compare-report.html changed in the artifact hub.",
    at: 1_704_066_800_000,
    read: false,
    scope: "artifacts",
    action: {
      type: "open-artifact",
      sessionId: "pi-preview-1",
      slug: "compare-report",
    },
  },
  {
    id: "inbox-preview-3",
    title: "Workflow run completed",
    body: "All nodes finished successfully.",
    at: 1_704_066_400_000,
    read: true,
    scope: "runs",
    action: null,
  },
] as const;

function noop(): void {}

function inboxRowsForCount(count: number): readonly InboxRow[] {
  return PREVIEW_INBOX_ROWS.slice(
    0,
    Math.max(0, Math.min(count, PREVIEW_INBOX_ROWS.length)),
  );
}

function previewSourceControl(changedCount: number): SourceControlSummary {
  return { changedCount } as SourceControlSummary;
}

export default function AppSidebarsPreview({
  primaryView = "explorer",
  secondaryView = "chat",
  sidebarPosition = "left",
  codeSurface = "sidebar",
  changedCount = 0,
  unreadChat = 0,
  unreadCode = 0,
  unreadInbox = 0,
  inboxItemCount = 0,
  primaryVisible = true,
  secondaryVisible = true,
  workspaceLabel = "Editor workspace",
}: AppSidebarsPreviewArgs) {
  const explorerRef = useRef<FileExplorerHandle | null>(null);
  const primaryWidthRef = useRef<PanelImperativeHandle | null>(null);
  const secondaryWidthRef = useRef<PanelImperativeHandle | null>(null);

  const panelContext = {
    workspaceRoot: PREVIEW_ROOT,
    activeCwd: PREVIEW_CWD,
    activeFile: PREVIEW_FILE,
    activeTerminalPrivate: false,
  } as const;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <AppSidebars
        sidebarPosition={sidebarPosition}
        workspace={
          <main className="flex h-full items-center justify-center bg-background/60 text-[12px] text-muted-foreground">
            {workspaceLabel}
          </main>
        }
        primary={{
          activeFilePath: PREVIEW_FILE,
          activeView: primaryView,
          defaultSize: 260,
          // @ts-expect-error preview mock with partial types
          explorerRef,
          rootPath: PREVIEW_ROOT,
          // @ts-expect-error preview mock with partial types
          sourceControl: previewSourceControl(changedCount),
          visible: primaryVisible,
          widthRef: primaryWidthRef,
          onAttachFileToAgent: noop,
          onOpenFile: noop,
          onOpenGitDiff: noop,
          onOpenGitGraph: noop,
          onOpenMarkdownPreview: noop,
          onPathDeleted: noop,
          onPathRenamed: noop,
          onResize: noop,
          onRevealInTerminal: noop,
          onSelectView: noop,
        }}
        secondary={{
          activeView: secondaryView,
          chatContext: panelContext,
          chatFocusRequest: null,
          codeContext: panelContext,
          codeSurface,
          defaultSize: 320,
          inboxRows: inboxRowsForCount(inboxItemCount),
          unreadCounts: {
            chat: unreadChat,
            code: unreadCode,
            inbox: unreadInbox,
          },
          visible: secondaryVisible,
          widthRef: secondaryWidthRef,
          piFocusRequest: null,
          onChatSelectedSessionChange: noop,
          onClearReadInboxRows: noop,
          onCodeSelectedSessionChange: noop,
          onMarkInboxRowsRead: noop,
          onOpenArtifactWorkspace: noop,
          onOpenCodePopOut: noop,
          onOpenCodeWorkspace: noop,
          onOpenInboxRow: noop,
          onOpenLocalAgent: noop,
          onResize: noop,
          onSelectView: noop,
        }}
      />
    </div>
  );
}
