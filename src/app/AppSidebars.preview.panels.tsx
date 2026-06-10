import type { InboxRow } from "@/modules/inbox/lib/model";

export type FileExplorerHandle = {
  focus: () => void;
};

function panelShell(label: string, detail: string) {
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-[11px] leading-snug text-muted-foreground">
      <p className="font-medium text-foreground">{label}</p>
      <p>{detail}</p>
    </div>
  );
}

export function FileExplorer(
  _props: unknown,
  _ref?: React.Ref<FileExplorerHandle>,
) {
  return panelShell(
    "File Explorer",
    "Deterministic preview tree rooted at preview/repo.",
  );
}

export function SourceControlPanel({
  sourceControl,
}: {
  open?: boolean;
  sourceControl?: { changedCount?: number };
  onOpenDiff?: (...args: unknown[]) => void;
  onOpenGitGraph?: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const changedCount = sourceControl?.changedCount ?? 0;
  return panelShell(
    "Source Control",
    `Git changes, branch metadata, and diff entry points (${changedCount} changed).`,
  );
}

export type SourceControlSummary = {
  changedCount: number;
};

export function getSourceControlRemoteIndicator() {
  return { visible: false, label: "", title: "" };
}

export function useSourceControl(): SourceControlSummary {
  return { changedCount: 0 };
}

export function InboxPanel({
  rows,
}: {
  rows: readonly InboxRow[];
  onClearRead?: () => void;
  onMarkRead?: (rowIds: readonly string[]) => void;
  onOpenRow?: (row: InboxRow) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-[11px] leading-snug">
      <p className="font-medium text-foreground">Inbox</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          No inbox items in this scenario.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="rounded-md border border-border/50 bg-background/80 px-2 py-1.5"
          >
            <p className="font-medium text-foreground">{row.title}</p>
            <p className="text-muted-foreground">{row.body}</p>
          </div>
        ))
      )}
    </div>
  );
}

export function ModelComparePanel({
  workspaceRoot,
  activeCwd,
}: {
  workspaceRoot?: string | null;
  activeCwd?: string | null;
  onOpenArtifactWorkspace?: (sessionId: string, slug?: string | null) => void;
}) {
  return panelShell(
    "Compare",
    `Model compare surface for ${workspaceRoot ?? "workspace"} (${activeCwd ?? "cwd"}).`,
  );
}

export function PiChatPanel({
  workspaceRoot,
  activeFile,
}: {
  workspaceRoot?: string | null;
  activeCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
  focusRequest?: unknown;
  onOpenArtifacts?: (sessionId: string, slug?: string | null) => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
  className?: string;
}) {
  const fileLabel = activeFile?.split("/").pop() ?? "AppSidebars.tsx";
  return panelShell(
    "Chat",
    `Workspace ${workspaceRoot ?? "preview/repo"} · active file ${fileLabel}`,
  );
}

export function PiPanel({
  workspaceRoot,
}: {
  workspaceRoot?: string | null;
  activeCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
  focusRequest?: unknown;
  onOpenLocalAgent?: (...args: unknown[]) => void;
  onOpenWorkspace?: () => void;
  onPopOut?: () => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
}) {
  return panelShell(
    "Code",
    `Pi code panel mounted in the secondary sidebar (${workspaceRoot ?? "preview/repo"}).`,
  );
}
