import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  copyToClipboard,
  revealInFinder,
} from "@/modules/explorer/lib/contextActions";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import { joinPath } from "@/modules/explorer/lib/useFileTree";
import {
  AiContentGenerator02Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  CheckmarkCircle01Icon,
  Download01Icon,
  FolderCloudIcon,
  FolderGitTwoIcon,
  GitBranchIcon,
  Refresh01Icon,
  RemoveSquareIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { gitStatusAccentClass } from "./gitStatusPalette";
import type { SourceControlSummary } from "./useSourceControl";
import {
  useSourceControlPanel,
  type CheckState,
  type SourceControlFileEntry,
} from "./useSourceControlPanel";

type Props = {
  open: boolean;
  sourceControl: SourceControlSummary;
  onOpenGitGraph?: () => void;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const SOURCE_CONTROL_TOOLTIP_CLASS =
  "border border-border/70 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:border-border/60 dark:bg-zinc-950 dark:text-zinc-100";

const ROW_HEIGHTS = {
  banner: 32,
  header: 30,
  entry: 30,
} as const;

type RowDescriptor =
  | { kind: "banner-diverged"; key: string }
  | { kind: "list-header"; key: string; count: number }
  | { kind: "entry"; key: string; entry: SourceControlFileEntry };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function entryPathLabel(entry: SourceControlFileEntry): string {
  if (entry.originalPath) return `${entry.originalPath} → ${entry.path}`;
  return dirname(entry.path);
}

function upstreamBadgeLabel(upstream: string | null | undefined): string {
  if (!upstream) return "No upstream";
  return upstream;
}

function checkboxValue(state: CheckState): boolean | "indeterminate" {
  if (state === "checked") return true;
  if (state === "indeterminate") return "indeterminate";
  return false;
}

export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  sourceControl,
  onOpenGitGraph,
  onOpenDiff,
  onOpenFile,
}: Props) {
  const scm = useSourceControlPanel(open, sourceControl, onOpenDiff);
  const refreshAnimationRef = useRef<number | null>(null);
  const [refreshAnimating, setRefreshAnimating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (refreshAnimationRef.current) {
        window.clearTimeout(refreshAnimationRef.current);
      }
    };
  }, []);

  const isRefreshing = scm.panelState === "loading";
  const repoLabel = useMemo(() => {
    if (!scm.status) return "Source Control";
    return scm.status.isDetached ? "detached" : scm.status.branch;
  }, [scm.status]);

  const commitShortcut = IS_MAC ? "⌘↩" : "Ctrl+Enter";
  const generateShortcut = IS_MAC ? "⌘G" : "Ctrl+G";
  const canCommit =
    scm.stagedEntries.length > 0 &&
    scm.commitMessage.trim().length > 0 &&
    !scm.actionBusy;
  const commitDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : scm.stagedEntries.length === 0
      ? "Stage changes to enable commit."
      : scm.commitMessage.trim().length === 0
        ? "Enter a commit message to enable commit."
        : null;
  const commitHint = canCommit
    ? `Commit with ${commitShortcut}.`
    : (commitDisabledReason ?? `Commit with ${commitShortcut}.`);
  const pushHint = scm.pushHint ?? "Push is unavailable right now.";
  const pushDisabledReason = scm.actionBusy
    ? "Wait for the current Git action to finish."
    : pushHint;
  const stagedCount = scm.stagedEntries.length;
  const changedCount = scm.fileEntries.length;
  const pushStatusLabel = upstreamBadgeLabel(scm.status?.upstream);
  const hasUpstream = !!scm.status?.upstream;
  const isDiverged =
    !!scm.status && scm.status.ahead > 0 && scm.status.behind > 0;

  const canPull =
    hasUpstream &&
    !!scm.status &&
    scm.status.behind > 0 &&
    !isDiverged &&
    !scm.actionBusy &&
    !sourceControl.busyAction;
  const canFetch = hasUpstream && !scm.actionBusy && !sourceControl.busyAction;

  const footerFeedback = useMemo(() => {
    if (scm.actionError)
      return { tone: "error", message: scm.actionError } as const;
    if (scm.remoteError)
      return { tone: "error", message: scm.remoteError } as const;
    if (scm.actionMessage)
      return { tone: "success", message: scm.actionMessage } as const;
    return null;
  }, [scm.actionError, scm.actionMessage, scm.remoteError]);

  const handleCommitShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      canCommit
    ) {
      event.preventDefault();
      void scm.commit();
      return;
    }
    if (
      event.key.toLowerCase() === "g" &&
      (event.metaKey || event.ctrlKey) &&
      scm.canGenerateCommitMessage
    ) {
      event.preventDefault();
      void scm.generateCommitMessage();
    }
  };

  const handleRefresh = useCallback(() => {
    setRefreshAnimating(true);
    if (refreshAnimationRef.current) {
      window.clearTimeout(refreshAnimationRef.current);
    }
    void scm.refresh().finally(() => {
      refreshAnimationRef.current = window.setTimeout(() => {
        setRefreshAnimating(false);
        refreshAnimationRef.current = null;
      }, 450);
    });
  }, [scm]);

  const handleFetch = useCallback(() => {
    void sourceControl.runRemoteAction("fetch");
  }, [sourceControl]);

  const handlePull = useCallback(() => {
    void sourceControl.runRemoteAction("pull");
  }, [sourceControl]);

  const rows = useMemo<RowDescriptor[]>(() => {
    const result: RowDescriptor[] = [];
    if (isDiverged) {
      result.push({ kind: "banner-diverged", key: "banner-diverged" });
    }
    if (changedCount > 0) {
      result.push({
        kind: "list-header",
        key: "list-header",
        count: changedCount,
      });
      for (const entry of scm.fileEntries) {
        result.push({ kind: "entry", key: entry.key, entry });
      }
    }
    return result;
  }, [changedCount, isDiverged, scm.fileEntries]);

  const rowKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(row.key, index));
    return map;
  }, [rows]);

  useEffect(() => {
    if (!focusedRowKey) return;
    if (!rowKeyToIndex.has(focusedRowKey)) {
      setFocusedRowKey(null);
    }
  }, [focusedRowKey, rowKeyToIndex]);

  const focusableIndices = useMemo(() => {
    const out: number[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "entry") out.push(index);
    });
    return out;
  }, [rows]);

  const estimateSize = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return ROW_HEIGHTS.entry;
      switch (row.kind) {
        case "banner-diverged":
          return ROW_HEIGHTS.banner;
        case "list-header":
          return ROW_HEIGHTS.header;
        case "entry":
          return ROW_HEIGHTS.entry;
      }
    },
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const moveFocus = useCallback(
    (direction: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const currentIndex =
        focusedRowKey === null ? -1 : (rowKeyToIndex.get(focusedRowKey) ?? -1);
      let pos = focusableIndices.findIndex((i) => i === currentIndex);
      if (pos === -1) pos = direction > 0 ? -1 : focusableIndices.length;
      let nextPos = pos + direction;
      if (nextPos < 0) nextPos = 0;
      if (nextPos > focusableIndices.length - 1)
        nextPos = focusableIndices.length - 1;
      const targetRowIndex = focusableIndices[nextPos];
      const target = rows[targetRowIndex];
      if (!target) return;
      setFocusedRowKey(target.key);
      virtualizer.scrollToIndex(targetRowIndex, { align: "auto" });
    },
    [focusableIndices, focusedRowKey, rowKeyToIndex, rows, virtualizer],
  );

  const focusedEntry = useCallback((): SourceControlFileEntry | null => {
    if (!focusedRowKey) return null;
    const index = rowKeyToIndex.get(focusedRowKey);
    if (index === undefined) return null;
    const row = rows[index];
    return row && row.kind === "entry" ? row.entry : null;
  }, [focusedRowKey, rowKeyToIndex, rows]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.closest("button"))
      ) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && (event.key === "r" || event.key === "R")) {
        event.preventDefault();
        handleRefresh();
        return;
      }
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveFocus(-1);
          break;
        case "Enter": {
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.selectFile(entry);
          }
          break;
        }
        case " ":
        case "s":
        case "S": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry) {
            event.preventDefault();
            void scm.toggleStageFile(entry);
          }
          break;
        }
        case "d":
        case "D": {
          if (meta) break;
          const entry = focusedEntry();
          if (entry && entry.unstaged) {
            event.preventDefault();
            scm.requestDiscardFile(entry);
          }
          break;
        }
      }
    },
    [focusedEntry, handleRefresh, moveFocus, scm],
  );

  if (!open) return null;

  const fetchBusy = sourceControl.busyAction === "fetch";
  const pullBusy = sourceControl.busyAction === "pull";

  return (
    <TooltipProvider delayDuration={800} skipDelayDuration={300}>
      <aside className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground transition-colors hover:bg-foreground/10">
              <HugeiconsIcon
                icon={FolderGitTwoIcon}
                size={12}
                strokeWidth={1.9}
                className="shrink-0 text-muted-foreground"
              />
              <span className="max-w-[140px] truncate">{repoLabel}</span>
            </div>
            {scm.status && (scm.status.ahead > 0 || scm.status.behind > 0) ? (
              <div className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none text-muted-foreground">
                {scm.status.ahead > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowUp01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.ahead}
                  </span>
                ) : null}
                {scm.status.behind > 0 ? (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={9}
                      strokeWidth={2.2}
                    />
                    {scm.status.behind}
                  </span>
                ) : null}
              </div>
            ) : null}
            {scm.status?.isDetached ? (
              <span className="rounded bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                detached
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconActionButton
              label={fetchBusy ? "Fetching…" : "Fetch from remote"}
              disabled={!canFetch}
              onClick={handleFetch}
              side="bottom"
            >
              {fetchBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={FolderCloudIcon}
                  size={14}
                  strokeWidth={1.85}
                />
              )}
            </IconActionButton>
            <IconActionButton
              label={
                pullBusy
                  ? "Pulling…"
                  : isDiverged
                    ? "Branch diverged — resolve in terminal"
                    : !hasUpstream
                      ? "No upstream configured"
                      : (scm.status?.behind ?? 0) === 0
                        ? "Already up to date"
                        : `Pull ${scm.status?.behind ?? 0} commits (fast-forward)`
              }
              disabled={!canPull}
              onClick={handlePull}
              side="bottom"
            >
              {pullBusy ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={Download01Icon}
                  size={14}
                  strokeWidth={1.9}
                />
              )}
            </IconActionButton>
            <IconActionButton
              label="Refresh source control"
              disabled={isRefreshing || !!scm.actionBusy}
              onClick={handleRefresh}
              side="bottom"
            >
              {isRefreshing ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  size={14}
                  strokeWidth={1.9}
                  className={cn(refreshAnimating && "animate-spin")}
                />
              )}
            </IconActionButton>
          </div>
        </header>

        {onOpenGitGraph ? (
          <button
            type="button"
            onClick={() => onOpenGitGraph()}
            className="group flex shrink-0 cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={13}
              strokeWidth={1.85}
              className="shrink-0"
            />
            <span className="flex-1 text-[12px] font-medium">Commit Graph</span>
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={12}
              strokeWidth={2}
              className="shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        ) : null}

        {scm.panelState === "loading" ? (
          <PanelCenter title="Loading repository" />
        ) : null}

        {scm.panelState === "no-repo" ? (
          <PanelCenter
            title="No repository"
            body="The active workspace is not inside a Git repository."
          />
        ) : null}

        {scm.panelState === "error" ? (
          <PanelCenter
            title="Source control error"
            body={scm.statusError ?? "Unknown source control error"}
            action={
              <Button size="sm" onClick={() => void scm.refresh()}>
                Retry
              </Button>
            }
          />
        ) : null}

        {scm.panelState === "ready" && scm.status ? (
          <>
            <div className="relative shrink-0 space-y-2 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 pb-2.5 pt-2.5">
              <div
                className={cn(
                  "relative rounded-lg border bg-background/95 shadow-sm transition-colors",
                  scm.commitMessage.length > 0
                    ? "border-border/70"
                    : "border-border/45",
                  "focus-within:border-primary/45 focus-within:shadow-md focus-within:shadow-primary/5",
                )}
              >
                <Textarea
                  value={scm.commitMessage}
                  onChange={(event) => scm.setCommitMessage(event.target.value)}
                  onKeyDown={handleCommitShortcut}
                  placeholder="Commit message"
                  rows={3}
                  className={cn(
                    "min-h-[72px] border-border resize-none rounded-lg bg-transparent px-3 pb-7 pt-2.5 text-[12.5px] leading-snug shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 focus:border-0",
                  )}
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex items-center justify-between p-1 gap-2 text-[10px] tabular-nums text-muted-foreground/55">
                  {scm.commitMessage.length > 0 ? (
                    <span>Ch: {scm.commitMessage.length}</span>
                  ) : (
                    <span className="flex gap-2 items-center">
                      {commitShortcut} <p>to commit</p>
                    </span>
                  )}
                </div>
                <div className="absolute right-1 top-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${scm.generateCommitMessageHint} (${generateShortcut})`}
                        disabled={!scm.canGenerateCommitMessage}
                        onClick={() => void scm.generateCommitMessage()}
                        className={cn(
                          "inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/65 transition-colors",
                          "hover:bg-foreground/[0.06] hover:text-foreground",
                          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/65",
                        )}
                      >
                        {scm.actionBusy === "generate-message" ? (
                          <Spinner className="size-3" />
                        ) : (
                          <HugeiconsIcon
                            icon={AiContentGenerator02Icon}
                            size={14}
                            strokeWidth={1.75}
                          />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className={cn(
                        SOURCE_CONTROL_TOOLTIP_CLASS,
                        "text-[10.5px]",
                      )}
                    >
                      {`${scm.generateCommitMessageHint} (${generateShortcut})`}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full transition-colors",
                    canCommit
                      ? "bg-foreground/80"
                      : stagedCount > 0
                        ? "bg-muted-foreground/60"
                        : "bg-muted-foreground/30",
                  )}
                />
                <span className="truncate font-medium text-foreground/85">
                  {stagedCount === 0
                    ? "Nothing staged"
                    : `${stagedCount} ${stagedCount === 1 ? "file" : "files"} staged`}
                </span>
                <span className="ml-auto shrink-0 truncate text-muted-foreground/65">
                  {pushStatusLabel}
                </span>
              </div>

              <div className="grid w-full grid-cols-2 gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs"
                      className="h-7 cursor-pointer text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
                      disabled={!canCommit}
                      onClick={() => void scm.commit()}
                    >
                      {scm.actionBusy === "commit" ? "Committing…" : "Commit"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className={cn(
                      SOURCE_CONTROL_TOOLTIP_CLASS,
                      "text-[10.5px]",
                    )}
                  >
                    {commitHint}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="xs"
                      variant="secondary"
                      className="h-7 cursor-pointer text-[11.5px] font-medium disabled:cursor-not-allowed"
                      disabled={!scm.canPush || !!scm.actionBusy}
                      onClick={() => void scm.push()}
                    >
                      {scm.actionBusy === "push" ? "Pushing…" : "Push"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className={cn(
                      SOURCE_CONTROL_TOOLTIP_CLASS,
                      "max-w-64 text-[10.5px]",
                    )}
                  >
                    {pushDisabledReason}
                  </TooltipContent>
                </Tooltip>
              </div>

              <CommitFeedback feedback={footerFeedback} />
            </div>

            {scm.allClean ? (
              <CleanTreeHint repoLabel={repoLabel} />
            ) : (
              <div
                ref={containerRef}
                tabIndex={0}
                role="listbox"
                aria-label="Changed files"
                aria-activedescendant={
                  focusedRowKey ? `scm-row-${focusedRowKey}` : undefined
                }
                onKeyDown={handlePanelKeyDown}
                className="relative min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
              >
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                >
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <RowRenderer
                            row={row}
                            focused={focusedRowKey === row.key}
                            selectedPath={scm.selected?.path ?? null}
                            actionBusy={scm.actionBusy}
                            headerCheckState={scm.headerCheckState}
                            repoRoot={scm.repo?.repoRoot ?? null}
                            onFocusRow={setFocusedRowKey}
                            onToggleAll={scm.toggleAll}
                            onSelectFile={scm.selectFile}
                            onToggleStageFile={scm.toggleStageFile}
                            onDiscardFile={scm.requestDiscardFile}
                            onOpenFile={onOpenFile}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : null}
      </aside>

      <AlertDialog
        open={scm.pendingDiscard !== null}
        onOpenChange={(o) => {
          if (!o) scm.cancelPendingDiscard();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {scm.pendingDiscard?.scope === "all"
                ? `This will discard ${scm.pendingDiscard.label} and cannot be undone.`
                : scm.pendingDiscard
                  ? `Discard changes in "${scm.pendingDiscard.label}"? This cannot be undone.`
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => scm.cancelPendingDiscard()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void scm.confirmPendingDiscard()}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
});

function PanelCenter({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-sm font-medium">{title}</div>
      {body ? (
        <div className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
          {body}
        </div>
      ) : null}
      {action}
    </div>
  );
}

function CleanTreeHint({ repoLabel }: { repoLabel: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
        <HugeiconsIcon
          icon={CheckmarkCircle01Icon}
          size={16}
          strokeWidth={1.6}
        />
      </div>
      <div className="text-[12px] font-medium text-foreground">
        Working tree clean
      </div>
      <div className="text-[10.5px] leading-snug text-muted-foreground">
        on <span className="font-mono text-foreground/80">{repoLabel}</span>
      </div>
    </div>
  );
}

type RowRendererProps = {
  row: RowDescriptor;
  focused: boolean;
  selectedPath: string | null;
  actionBusy: string | null;
  headerCheckState: CheckState;
  repoRoot: string | null;
  onFocusRow: (key: string | null) => void;
  onToggleAll: () => Promise<void> | void;
  onSelectFile: (entry: SourceControlFileEntry) => Promise<void>;
  onToggleStageFile: (entry: SourceControlFileEntry) => Promise<void>;
  onDiscardFile: (entry: SourceControlFileEntry) => void;
  onOpenFile?: (absolutePath: string) => void;
};

const RowRenderer = memo(function RowRenderer(props: RowRendererProps) {
  const { row } = props;
  switch (row.kind) {
    case "banner-diverged":
      return <DivergedBanner />;
    case "list-header":
      return <ListHeader {...props} row={row} />;
    case "entry":
      return <EntryRow {...props} row={row} />;
  }
});

function DivergedBanner() {
  return (
    <div className="mx-2 mt-1 flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-foreground/[0.04] px-2 text-[10.5px] leading-none text-muted-foreground">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={11}
        strokeWidth={1.9}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground/85">
          Diverged from upstream
        </span>
        <span className="ml-1 opacity-75">— resolve in terminal</span>
      </span>
    </div>
  );
}

function ListHeader({
  row,
  actionBusy,
  headerCheckState,
  onToggleAll,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "list-header" }>;
}) {
  return (
    <div className="flex h-7 items-center gap-2 px-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        Changes
      </span>
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
        {row.count}
      </span>
      <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground">
        <span>All</span>
        <Checkbox
          aria-label="Stage all changes"
          checked={checkboxValue(headerCheckState)}
          disabled={actionBusy !== null}
          onCheckedChange={() => void onToggleAll()}
          className="size-3.5"
        />
      </label>
    </div>
  );
}

const EntryRow = memo(function EntryRow({
  row,
  focused,
  selectedPath,
  actionBusy,
  repoRoot,
  onFocusRow,
  onSelectFile,
  onToggleStageFile,
  onDiscardFile,
  onOpenFile,
}: RowRendererProps & {
  row: Extract<RowDescriptor, { kind: "entry" }>;
}) {
  const entry = row.entry;
  const isSelected = selectedPath === entry.path;
  const fileName = basename(entry.path);
  const iconUrl = fileIconUrl(fileName);
  const pathLabel = entryPathLabel(entry);
  const showDiscard = entry.unstaged;
  const isStageBusy =
    actionBusy === `stage:${entry.path}` ||
    actionBusy === `unstage:${entry.path}`;
  const isDiscardBusy = actionBusy === `discard:${entry.path}`;
  const disabled = actionBusy !== null;

  const absolutePath = repoRoot
    ? joinPath(repoRoot.replace(/\\/g, "/"), entry.path.replace(/\\/g, "/"))
    : null;
  const isDeleted = entry.statusCode === "D";
  const revealLabel = IS_MAC ? "Reveal in Finder" : "Reveal in File Manager";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          id={`scm-row-${row.key}`}
          data-focused={focused || undefined}
          data-selected={isSelected || undefined}
          role="option"
          aria-selected={isSelected}
          onMouseDown={() => onFocusRow(row.key)}
          className={cn(
            "group relative flex h-[30px] items-center gap-2 rounded-md pl-2 pr-2 transition-all duration-100",
            focused
              ? "bg-accent/60"
              : isSelected
                ? "bg-accent/55 text-foreground"
                : "hover:bg-accent/30",
          )}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full transition-opacity",
              gitStatusAccentClass(entry.statusCode),
              isSelected || focused
                ? "opacity-100"
                : "opacity-55 group-hover:opacity-95",
            )}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => {
              onFocusRow(row.key);
              void onSelectFile(entry);
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-4 shrink-0" />
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
              <span
                className={cn(
                  "truncate text-[12px] leading-tight",
                  isSelected || focused
                    ? "font-semibold text-foreground"
                    : "font-medium text-foreground/95",
                  pathLabel ? "max-w-[58%] shrink-0" : "min-w-0 flex-1",
                )}
              >
                {fileName}
              </span>
              {pathLabel ? (
                <span className="min-w-0 flex-1 truncate text-[10.5px] leading-tight text-muted-foreground/75">
                  {pathLabel}
                </span>
              ) : null}
            </div>
          </button>

          {showDiscard ? (
            <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 data-[focused=true]:opacity-100 data-[selected=true]:opacity-100">
              <IconActionButton
                label={`Discard ${entry.path}`}
                disabled={disabled}
                side="top"
                onClick={() => onDiscardFile(entry)}
              >
                {isDiscardBusy ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={RemoveSquareIcon}
                    size={11}
                    strokeWidth={1.9}
                  />
                )}
              </IconActionButton>
            </div>
          ) : null}

          <span className="flex size-5 shrink-0 items-center justify-center">
            {isStageBusy ? (
              <Spinner className="size-3" />
            ) : (
              <Checkbox
                aria-label={`Stage ${entry.path}`}
                checked={checkboxValue(entry.checkState)}
                disabled={disabled}
                onCheckedChange={() => void onToggleStageFile(entry)}
                className="size-3.5"
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className={COMPACT_CONTENT}>
        {/* Open actions */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => {
            onFocusRow(row.key);
            void onSelectFile(entry);
          }}
        >
          Open Diff
        </ContextMenuItem>
        {!isDeleted && onOpenFile && absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => onOpenFile(absolutePath)}
          >
            Open File
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Stage / Unstage */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          disabled={disabled}
          onSelect={() => void onToggleStageFile(entry)}
        >
          {entry.checkState === "checked" ? "Unstage" : "Stage"}
        </ContextMenuItem>
        {entry.unstaged ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            variant="destructive"
            disabled={disabled}
            onSelect={() => onDiscardFile(entry)}
          >
            Discard Changes
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        {/* Copy paths */}
        <ContextMenuItem
          className={COMPACT_ITEM}
          onSelect={() => void copyToClipboard(entry.path.replace(/\\/g, "/"))}
        >
          Copy Relative Path
        </ContextMenuItem>
        {absolutePath ? (
          <ContextMenuItem
            className={COMPACT_ITEM}
            onSelect={() => void copyToClipboard(absolutePath)}
          >
            Copy Absolute Path
          </ContextMenuItem>
        ) : null}

        {/* Reveal in Finder — only for existing files */}
        {!isDeleted && absolutePath ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void revealInFinder(absolutePath)}
            >
              {revealLabel}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function IconActionButton({
  label,
  disabled,
  side = "left",
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  side?: "left" | "top" | "right" | "bottom";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-6 p-3 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className={cn(SOURCE_CONTROL_TOOLTIP_CLASS, "text-[10.5px]")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CommitFeedback({
  feedback,
}: {
  feedback: { tone: "error" | "success"; message: string } | null;
}) {
  const [visibleFeedback, setVisibleFeedback] = useState(feedback);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!feedback) {
      setIsVisible(false);
      return;
    }
    setVisibleFeedback(feedback);
    setIsVisible(true);
    const hideTimer = window.setTimeout(() => setIsVisible(false), 3600);
    const clearTimer = window.setTimeout(() => {
      setVisibleFeedback((current) =>
        current?.message === feedback.message && current.tone === feedback.tone
          ? null
          : current,
      );
    }, 3900);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [feedback]);

  if (!visibleFeedback) return null;

  const isError = visibleFeedback.tone === "error";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-[calc(100%-0.25rem)] z-20 flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg shadow-black/15 backdrop-blur transition-all duration-200",
        isVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
        isError
          ? "border-destructive/30 bg-card/95 text-destructive"
          : "border-border/70 bg-card/95 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isError ? "bg-destructive" : "bg-foreground/70",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {visibleFeedback.message}
      </span>
    </div>
  );
}
