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
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  native,
  type GitCommitFileChange,
  type GitLogEntry,
} from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  GitBranchIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const HISTORY_HEADER_PX = 29;

const PAGE_SIZE = 30;
const NEAR_BOTTOM_PX = 160;
const FILES_CACHE_LIMIT = 16;

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  repoRoot: string | null;
  refreshKey: unknown;
  collapsed: boolean;
  topCommitPushed: boolean;
  onToggleCollapsed: () => void;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  onOpenGitGraph?: () => void;
  onDidUndoCommit?: () => void;
};

type LoadStatus = "idle" | "initial" | "more" | "error";

type FilesEntry =
  | { state: "loading" }
  | { state: "loaded"; files: GitCommitFileChange[] }
  | { state: "error"; error: string };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

export function relativeTime(secs: number, nowMs: number): string {
  if (!secs) return "";
  const diff = Math.max(0, Math.floor(nowMs / 1000) - secs);
  if (diff < 60) return "now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

function statusTone(code: string): string {
  switch (code.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-300";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    case "R":
    case "C":
      return "text-sky-600 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

export function CommitHistorySection({
  repoRoot,
  refreshKey,
  collapsed,
  topCommitPushed,
  onToggleCollapsed,
  onOpenCommitFile,
  onOpenGitGraph,
  onDidUndoCommit,
}: Props) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [filesTick, setFilesTick] = useState(0);

  const requestIdRef = useRef(0);
  const inflightMoreRef = useRef(false);
  const filesInflightRef = useRef(new Set<string>());
  const filesCacheRef = useRef(new Map<string, FilesEntry>());
  const commitsRef = useRef<GitLogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bumpFiles = useCallback(() => setFilesTick((n) => n + 1), []);

  const replaceCommits = useCallback((entries: GitLogEntry[]) => {
    commitsRef.current = entries;
    setCommits(entries);
  }, []);

  const loadInitial = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!repoRoot) {
      replaceCommits([]);
      setLoadStatus("idle");
      setError(null);
      setEndReached(true);
      return;
    }
    setLoadStatus("initial");
    setError(null);
    try {
      const entries = await native.gitLog(repoRoot, { limit: PAGE_SIZE });
      if (requestId !== requestIdRef.current) return;
      const prev = commitsRef.current;
      const unchanged =
        prev.length >= entries.length &&
        entries.every((e, i) => prev[i]?.sha === e.sha);
      if (!unchanged) {
        filesInflightRef.current.clear();
        filesCacheRef.current.clear();
        bumpFiles();
        setExpandedSha(null);
        replaceCommits(entries);
        setEndReached(entries.length < PAGE_SIZE);
      }
      setLoadStatus("idle");
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(normalizeError(err));
      setLoadStatus("error");
    }
  }, [bumpFiles, repoRoot, replaceCommits]);

  const loadMore = useCallback(async () => {
    if (!repoRoot) return;
    if (inflightMoreRef.current || endReached) return;
    if (loadStatus !== "idle") return;
    const last = commitsRef.current[commitsRef.current.length - 1];
    if (!last) return;
    inflightMoreRef.current = true;
    setLoadStatus("more");
    try {
      const entries = await native.gitLog(repoRoot, {
        limit: PAGE_SIZE,
        beforeSha: last.sha,
      });
      const seen = new Set(commitsRef.current.map((c) => c.sha));
      const merged = [...commitsRef.current];
      for (const e of entries) if (!seen.has(e.sha)) merged.push(e);
      replaceCommits(merged);
      if (entries.length < PAGE_SIZE) setEndReached(true);
      setLoadStatus("idle");
    } catch (err) {
      setError(normalizeError(err));
      setLoadStatus("error");
    } finally {
      inflightMoreRef.current = false;
    }
  }, [endReached, loadStatus, repoRoot, replaceCommits]);

  const lastRepoRef = useRef<string | null | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-runs the initial load after commit/push/refresh
  useEffect(() => {
    if (lastRepoRef.current !== repoRoot) {
      lastRepoRef.current = repoRoot;
      filesInflightRef.current.clear();
      filesCacheRef.current.clear();
      bumpFiles();
      setExpandedSha(null);
      replaceCommits([]);
    }
    void loadInitial();
  }, [bumpFiles, loadInitial, refreshKey, repoRoot, replaceCommits]);

  const fetchFiles = useCallback(
    async (sha: string) => {
      if (!repoRoot) return;
      if (filesInflightRef.current.has(sha)) return;
      const cache = filesCacheRef.current;
      const existing = cache.get(sha);
      if (existing && existing.state !== "error") return;
      filesInflightRef.current.add(sha);
      cache.set(sha, { state: "loading" });
      bumpFiles();
      try {
        const files = await native.gitCommitFiles(repoRoot, sha);
        cache.set(sha, { state: "loaded", files });
        while (cache.size > FILES_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined || oldest === sha) break;
          cache.delete(oldest);
        }
        bumpFiles();
      } catch (err) {
        cache.set(sha, { state: "error", error: normalizeError(err) });
        bumpFiles();
      } finally {
        filesInflightRef.current.delete(sha);
      }
    },
    [bumpFiles, repoRoot],
  );

  const toggleCommit = useCallback(
    (sha: string) => {
      setExpandedSha((prev) => (prev === sha ? null : sha));
      void fetchFiles(sha);
    },
    [fetchFiles],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < NEAR_BOTTOM_PX) void loadMore();
  }, [loadMore]);

  useEffect(() => {
    if (collapsed) return;
    if (loadStatus !== "idle" || endReached || commits.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.clientHeight > NEAR_BOTTOM_PX) return;
    const id = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(id);
  }, [collapsed, commits.length, endReached, loadMore, loadStatus]);

  const handleRefresh = useCallback(() => {
    void loadInitial();
  }, [loadInitial]);

  const [pendingUndo, setPendingUndo] = useState<GitLogEntry | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const confirmUndo = useCallback(async () => {
    const commit = pendingUndo;
    if (!commit || !repoRoot || undoBusy) return;
    setUndoBusy(true);
    try {
      await native.gitUndoCommit(repoRoot, commit.sha);
      setPendingUndo(null);
      void loadInitial();
      onDidUndoCommit?.();
    } catch (err) {
      setPendingUndo(null);
      toast.error(`Undo commit failed: ${normalizeError(err)}`);
    } finally {
      setUndoBusy(false);
    }
  }, [loadInitial, onDidUndoCommit, pendingUndo, repoRoot, undoBusy]);

  const nowMs = Date.now();

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border/50">
      <div
        className="group flex shrink-0 items-center gap-1 px-2"
        style={{ height: HISTORY_HEADER_PX }}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={!collapsed}
        >
          <HugeiconsIcon
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
            size={11}
            strokeWidth={2.2}
            className="shrink-0"
          />
          <span className="truncate text-[10.5px] font-semibold uppercase tracking-wider">
            Commits
          </span>
        </button>
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
            !collapsed && "opacity-100",
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh commits"
                className="size-5 cursor-pointer rounded text-muted-foreground hover:text-foreground"
                onClick={handleRefresh}
              >
                <HugeiconsIcon icon={Refresh01Icon} size={11.5} strokeWidth={1.9} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10.5px]">
              Refresh commits
            </TooltipContent>
          </Tooltip>
          {onOpenGitGraph ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Open commit graph"
                  className="size-5 cursor-pointer rounded text-muted-foreground hover:text-foreground"
                  onClick={onOpenGitGraph}
                >
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    size={11.5}
                    strokeWidth={1.9}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10.5px]">
                Open commit graph
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {collapsed ? null : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
        >
          {loadStatus === "initial" && commits.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Spinner className="size-3.5" />
            </div>
          ) : loadStatus === "error" && commits.length === 0 ? (
            <div className="space-y-2 px-3 py-4 text-[11px] text-muted-foreground">
              <p className="break-words">{error}</p>
              <Button size="xs" variant="secondary" onClick={handleRefresh}>
                Retry
              </Button>
            </div>
          ) : commits.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-muted-foreground">
              No commits yet.
            </p>
          ) : (
            <div data-files-tick={filesTick}>
              {commits.map((commit, index) => (
                <CommitRow
                  key={commit.sha}
                  commit={commit}
                  nowMs={nowMs}
                  expanded={expandedSha === commit.sha}
                  filesEntry={
                    expandedSha === commit.sha
                      ? (filesCacheRef.current.get(commit.sha) ?? null)
                      : null
                  }
                  repoRoot={repoRoot}
                  canUndo={index === 0 && commit.parents.length > 0}
                  onRequestUndo={setPendingUndo}
                  onToggle={toggleCommit}
                  onRetryFiles={fetchFiles}
                  onOpenCommitFile={onOpenCommitFile}
                />
              ))}
              {loadStatus === "more" ? (
                <div className="flex items-center justify-center py-2">
                  <Spinner className="size-3" />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={pendingUndo !== null}
        onOpenChange={(o) => {
          if (!o && !undoBusy) setPendingUndo(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo last commit?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUndo
                ? `"${pendingUndo.subject}" will be removed from history and its changes returned to the staged area.${
                    topCommitPushed
                      ? " This commit looks already pushed; undoing it rewrites history and the branch will diverge from its upstream."
                      : ""
                  }`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={undoBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={undoBusy}
              onClick={(event) => {
                event.preventDefault();
                void confirmUndo();
              }}
            >
              {undoBusy ? "Undoing" : "Undo Commit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const CommitRow = memo(function CommitRow({
  commit,
  nowMs,
  expanded,
  filesEntry,
  repoRoot,
  canUndo,
  onRequestUndo,
  onToggle,
  onRetryFiles,
  onOpenCommitFile,
}: {
  commit: GitLogEntry;
  nowMs: number;
  expanded: boolean;
  filesEntry: FilesEntry | null;
  repoRoot: string | null;
  canUndo: boolean;
  onRequestUndo: (commit: GitLogEntry) => void;
  onToggle: (sha: string) => void;
  onRetryFiles: (sha: string) => void;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
}) {
  const isMerge = commit.parents.length > 1;
  return (
    <div>
      <div className="group relative">
        <button
          type="button"
          onClick={() => onToggle(commit.sha)}
          title={`${commit.subject}\n${commit.shortSha} by ${commit.author}`}
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 px-2 py-[5px] text-left transition-colors hover:bg-foreground/[0.05]",
            expanded && "bg-foreground/[0.04]",
          )}
        >
          <HugeiconsIcon
            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
            size={10}
            strokeWidth={2.2}
            className="shrink-0 text-muted-foreground/70"
          />
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              isMerge ? "bg-muted-foreground/50" : "bg-primary/70",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[11.5px] leading-tight text-foreground/90">
            {commit.subject}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {relativeTime(commit.timestampSecs, nowMs)}
          </span>
        </button>
        {canUndo ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Undo last commit"
                onClick={() => onRequestUndo(commit)}
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 cursor-pointer items-center justify-center rounded bg-card p-1 text-muted-foreground shadow-sm transition-colors hover:text-foreground group-hover:flex"
              >
                <HugeiconsIcon
                  icon={ArrowTurnBackwardIcon}
                  size={12}
                  strokeWidth={1.9}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-[10.5px]">
              Undo last commit
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-b border-border/30 pb-1">
          <div className="flex items-center gap-1.5 px-6 pb-1 pt-0.5 text-[10px] text-muted-foreground/75">
            <span className="font-mono">{commit.shortSha}</span>
            <span className="truncate">{commit.author}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {commit.filesChanged}{" "}
              {commit.filesChanged === 1 ? "file" : "files"}
            </span>
          </div>
          {!filesEntry || filesEntry.state === "loading" ? (
            <div className="flex items-center gap-1.5 px-6 py-1 text-[10.5px] text-muted-foreground">
              <Spinner className="size-2.5" /> Loading files
            </div>
          ) : filesEntry.state === "error" ? (
            <div className="space-y-1 px-6 py-1 text-[10.5px] text-muted-foreground">
              <p className="break-words">{filesEntry.error}</p>
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                onClick={() => onRetryFiles(commit.sha)}
              >
                Retry
              </button>
            </div>
          ) : (
            filesEntry.files.map((file) => (
              <button
                key={`${file.path}:${file.status}`}
                type="button"
                title={file.path}
                onClick={() => {
                  if (!repoRoot) return;
                  onOpenCommitFile({
                    repoRoot,
                    sha: commit.sha,
                    shortSha: commit.shortSha,
                    subject: commit.subject,
                    path: file.path,
                    originalPath: file.originalPath,
                  });
                }}
                className="flex w-full cursor-pointer items-center gap-1.5 py-[3px] pl-6 pr-2 text-left transition-colors hover:bg-foreground/[0.05]"
              >
                <img
                  src={fileIconUrl(basename(file.path))}
                  alt=""
                  className="size-3.5 shrink-0"
                  draggable={false}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">
                  {basename(file.path)}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-[9.5px] font-semibold",
                    statusTone(file.status),
                  )}
                >
                  {file.status.toUpperCase()}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
});
