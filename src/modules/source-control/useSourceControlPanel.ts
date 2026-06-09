import {
  native,
  type GitChangedFile,
  type GitDiscardEntry,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { providerNeedsKey, resolveModel } from "@/modules/ai/config";
import {
  invalidateDiff,
  invalidateRepoDiffs,
  workingDiffKey,
} from "@/modules/editor/lib/diffCache";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSourceControlEntryModel,
  type CheckState,
  type DiffMode,
  type SourceControlEntry,
  type SourceControlFileEntry,
  type SourceControlSection,
  entrySelectionKey,
  resolveSectionBatchEntries,
} from "./sourceControlEntries";
import type { SourceControlSummary } from "./useSourceControl";

type PanelState = "closed" | "loading" | "no-repo" | "ready" | "error";
type SelectionTransition = "none" | "moved-group" | "reset";

const COMMIT_DIFF_CHAR_LIMIT = 60_000;
const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 1024;
const RECONCILE_DEBOUNCE_MS = 180;
const CONVENTIONAL_PREFIX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?: .+/;
const COMMIT_MESSAGE_SYSTEM_PROMPT =
  "You write concise Conventional Commit subject lines in English. Return exactly one complete line, with no markdown, no quotes, no body, and no explanation.";

export type DiffSelection = {
  path: string;
  mode: DiffMode;
};

export type {
  CheckState,
  DiffMode,
  SourceControlEntry,
  SourceControlFileEntry,
};

export type PendingDiscard = {
  scope: "single" | "all";
  count: number;
  label: string;
};

type SourceControlPanelState = {
  panelState: PanelState;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  selected: DiffSelection | null;
  commitMessage: string;
  commitSucceeded: boolean;
  actionBusy: string | null;
  statusError: string | null;
  actionError: string | null;
  remoteError: string | null;
  actionMessage: string | null;
  stagedEntries: SourceControlEntry[];
  unstagedEntries: SourceControlEntry[];
  fileEntries: SourceControlFileEntry[];
  headerCheckState: CheckState;
  markedEntryKeys: string[];
  allClean: boolean;
  canPush: boolean;
  pushHint: string | null;
  canGenerateCommitMessage: boolean;
  generateCommitMessageHint: string;
  selectionTransition: SelectionTransition;
  stagedEmptyText: string;
  unstagedEmptyText: string;
  pendingDiscard: PendingDiscard | null;
  setCommitMessage: (value: string) => void;
  refresh: () => Promise<void>;
  selectEntry: (entry: SourceControlEntry) => Promise<void>;
  selectFile: (entry: SourceControlFileEntry) => Promise<void>;
  stageEntry: (entry: SourceControlEntry) => Promise<void>;
  unstageEntry: (entry: SourceControlEntry) => Promise<void>;
  toggleMarkedEntry: (entry: SourceControlEntry) => void;
  clearMarkedEntries: () => void;
  stageSectionEntries: (section: SourceControlSection) => Promise<void>;
  unstageSectionEntries: (section: SourceControlSection) => Promise<void>;
  requestDiscardEntry: (entry: SourceControlEntry) => void;
  requestDiscardFile: (entry: SourceControlFileEntry) => void;
  requestDiscardAll: () => void;
  confirmPendingDiscard: () => Promise<void>;
  cancelPendingDiscard: () => void;
  stageAllEntries: () => Promise<void>;
  unstageAllEntries: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
  commit: () => Promise<void>;
  commitAndPush: () => Promise<void>;
  commitAndSync: () => Promise<void>;
  push: () => Promise<void>;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown source control error";
}

function sameSelection(
  a: DiffSelection | null,
  b: DiffSelection | null,
): boolean {
  return !!a && !!b && a.path === b.path && a.mode === b.mode;
}

function stagedFilesSummary(entries: SourceControlEntry[]): string {
  return entries
    .map((entry) => {
      const status = entry.originalPath
        ? `R ${entry.originalPath} -> ${entry.path}`
        : `${entry.statusCode} ${entry.path}`;
      return `- ${status}`;
    })
    .join("\n");
}

function truncateDiff(diff: string): { text: string; truncated: boolean } {
  if (diff.length <= COMMIT_DIFF_CHAR_LIMIT) {
    return { text: diff, truncated: false };
  }
  return { text: diff.slice(0, COMMIT_DIFF_CHAR_LIMIT), truncated: true };
}

function cleanCommitMessage(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1].trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return firstLine.replace(/^["'`]+|["'`]+$/g, "").trim();
}

function isValidCommitMessage(message: string): boolean {
  return CONVENTIONAL_PREFIX.test(message);
}

function buildCommitMessagePrompt(
  entries: SourceControlEntry[],
  diffText: string,
  truncated: boolean,
): string {
  return [
    "Generate one complete commit message for the staged changes only.",
    "Format: type(scope): subject",
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "Examples:",
    "- feat(source-control): generate commit messages",
    "- fix(git): handle staged diff errors",
    "- chore: update project metadata",
    "Use a short lowercase subject in imperative mood. Omit the scope if it would be vague.",
    "Do not stop after the type or an opening parenthesis; the line must include a subject after ': '.",
    truncated
      ? "The diff below was truncated; infer from the visible staged changes only."
      : "The full staged diff is included below.",
    "",
    "Staged files:",
    stagedFilesSummary(entries),
    "",
    "Staged diff:",
    diffText || "(No textual diff available.)",
  ].join("\n");
}

function buildRepairCommitMessagePrompt(
  invalidMessage: string,
  entries: SourceControlEntry[],
): string {
  return [
    "Repair this invalid Conventional Commit subject line.",
    `Invalid line: ${invalidMessage || "(empty)"}`,
    "Return exactly one complete valid line in this format: type(scope): subject",
    "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "If the scope is unclear, omit it and use: type: subject",
    "",
    "Staged files:",
    stagedFilesSummary(entries),
  ].join("\n");
}

function optimisticStage(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next = status.changedFiles.map((file) => {
    if (!paths.has(file.path)) return file;
    if (file.staged && !file.unstaged) return file;
    changed = true;
    const wt =
      file.worktreeStatus !== " " ? file.worktreeStatus : file.indexStatus;
    return {
      ...file,
      indexStatus: wt,
      worktreeStatus: " ",
      staged: true,
      unstaged: false,
      untracked: false,
    };
  });
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

function optimisticUnstage(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next: GitChangedFile[] = [];
  for (const file of status.changedFiles) {
    if (!paths.has(file.path)) {
      next.push(file);
      continue;
    }
    if (!file.staged && file.unstaged) {
      next.push(file);
      continue;
    }
    changed = true;
    const idx =
      file.indexStatus !== " " ? file.indexStatus : file.worktreeStatus;
    if (idx === "R" && file.originalPath) {
      next.push({
        path: file.originalPath,
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "D",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Deleted",
      });
      next.push({
        path: file.path,
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "?",
        staged: false,
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      });
      continue;
    }
    next.push({
      ...file,
      originalPath: null,
      indexStatus: " ",
      worktreeStatus: idx === "A" ? "?" : idx,
      staged: false,
      unstaged: true,
      untracked: idx === "A",
    });
  }
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

function optimisticDiscard(
  status: GitStatusSnapshot,
  paths: Set<string>,
): GitStatusSnapshot {
  let changed = false;
  const next: GitChangedFile[] = [];
  for (const file of status.changedFiles) {
    if (!paths.has(file.path)) {
      next.push(file);
      continue;
    }
    if (file.staged) {
      changed = true;
      next.push({
        ...file,
        worktreeStatus: " ",
        unstaged: false,
        untracked: false,
      });
    } else {
      changed = true;
    }
  }
  if (!changed) return status;
  return { ...status, changedFiles: next };
}

export function useSourceControlPanel(
  isOpen: boolean,
  summary: SourceControlSummary,
  onOpenDiff:
    | ((input: {
        path: string;
        repoRoot: string;
        mode: DiffMode;
        originalPath: string | null;
        title?: string;
      }) => void)
    | null,
): SourceControlPanelState {
  const selectedModelId = useChatStore((state) => state.selectedModelId);
  const agentStatus = useChatStore((state) => state.agentMeta.status);
  const hasApiKeyForSelected = useChatStore((state) => {
    const model = resolveModel(state.selectedModelId);
    return !providerNeedsKey(model.provider) || !!state.apiKeys[model.provider];
  });
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const mlxModelId = usePreferencesStore((state) => state.mlxModelId);
  const ollamaModelId = usePreferencesStore((state) => state.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const openrouterModelId = usePreferencesStore(
    (state) => state.openrouterModelId,
  );
  const [panelState, setPanelState] = useState<PanelState>("closed");
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [selected, setSelected] = useState<DiffSelection | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitSucceeded, setCommitSucceeded] = useState(false);
  const [localActionBusy, setLocalActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [markedEntryKeys, setMarkedEntryKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionTransition, setSelectionTransition] =
    useState<SelectionTransition>("none");
  const [pendingDiscard, setPendingDiscard] = useState<
    | { scope: "single"; entry: SourceControlEntry }
    | { scope: "all"; entries: SourceControlEntry[] }
    | null
  >(null);
  const selectedRef = useRef<DiffSelection | null>(null);
  const repoRootRef = useRef<string | null>(null);
  const reconcileTimerRef = useRef(0);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const nextRoot = repo?.repoRoot ?? null;
    if (repoRootRef.current === nextRoot) return;
    repoRootRef.current = nextRoot;
    setMarkedEntryKeys(new Set());
  });

  const entryModel = useMemo(
    () => buildSourceControlEntryModel(status?.changedFiles ?? []),
    [status],
  );
  const { stagedEntries, unstagedEntries, fileEntries, headerCheckState } =
    entryModel;
  const markedKeyList = useMemo(
    () => Array.from(markedEntryKeys),
    [markedEntryKeys],
  );

  useEffect(() => {
    const validKeys = new Set([
      ...stagedEntries.map(entrySelectionKey),
      ...unstagedEntries.map(entrySelectionKey),
    ]);
    setMarkedEntryKeys((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of current) {
        if (validKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      }
      if (!changed && next.size === current.size) return current;
      return next;
    });
  }, [stagedEntries, unstagedEntries]);

  const allClean = stagedEntries.length === 0 && unstagedEntries.length === 0;
  const canPush = !!status?.upstream && status.behind === 0;
  const selectedModel = resolveModel(selectedModelId);
  const aiBusy = agentStatus !== "idle" && agentStatus !== "error";
  const anyActionBusy = localActionBusy !== null || summary.busyAction !== null;
  const aiUnavailableReason = useMemo(() => {
    if (stagedEntries.length === 0) {
      return "Stage changes to generate a commit message";
    }
    if (!hasApiKeyForSelected) {
      return "Connect an AI provider to generate commit messages";
    }
    if (selectedModel.id === "lmstudio-local" && !lmstudioModelId.trim()) {
      return "Connect an AI provider to generate commit messages";
    }
    if (selectedModel.id === "mlx-local" && !mlxModelId.trim()) {
      return "Connect an AI provider to generate commit messages";
    }
    if (selectedModel.id === "ollama-local" && !ollamaModelId.trim()) {
      return "Connect an AI provider to generate commit messages";
    }
    if (
      selectedModel.id === "openai-compatible-custom" &&
      (!openaiCompatibleBaseURL.trim() || !openaiCompatibleModelId.trim())
    ) {
      return "Connect an AI provider to generate commit messages";
    }
    if (selectedModel.id === "openrouter-custom" && !openrouterModelId.trim()) {
      return "Connect an AI provider to generate commit messages";
    }
    return null;
  }, [
    hasApiKeyForSelected,
    lmstudioModelId,
    mlxModelId,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    selectedModel,
    stagedEntries.length,
  ]);
  const canGenerateCommitMessage =
    stagedEntries.length > 0 && !anyActionBusy && !aiBusy && !!repo;
  const generateCommitMessageHint = aiUnavailableReason
    ? aiUnavailableReason
    : aiBusy
      ? "Wait for the current AI action to finish"
      : "Generate commit message";
  const pushHint = useMemo(() => {
    if (!status) return null;
    if (!status.upstream) {
      return "Configure or publish this branch in the terminal to enable push in this iteration.";
    }
    if (status.behind > 0) {
      return "Pull remote changes before pushing local commits.";
    }
    if (status.ahead === 0) {
      return `No local commits to push to ${status.upstream}.`;
    }
    return `Pushes to ${status.upstream}.`;
  }, [status]);
  const stagedEmptyText = "No staged changes";
  const unstagedEmptyText = "No unstaged changes";

  const updateCommitMessage = useCallback((value: string) => {
    setCommitMessage(value);
    setCommitSucceeded(false);
  }, []);

  const cancelReconcile = useCallback(() => {
    if (reconcileTimerRef.current) {
      window.clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = 0;
    }
  }, []);

  const scheduleReconcile = useCallback(() => {
    cancelReconcile();
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = 0;
      void summary.refresh({ remote: "never" });
    }, RECONCILE_DEBOUNCE_MS);
  }, [cancelReconcile, summary]);

  useEffect(() => () => cancelReconcile(), [cancelReconcile]);

  const openSelection = useCallback(
    (
      sel: DiffSelection,
      repoRoot: string,
      file: GitChangedFile | undefined,
    ) => {
      onOpenDiff?.({
        path: sel.path,
        repoRoot,
        mode: sel.mode,
        originalPath: file?.originalPath ?? null,
      });
    },
    [onOpenDiff],
  );

  const refresh = useCallback(async () => {
    if (!isOpen) {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    if (summary.repo) invalidateRepoDiffs(summary.repo.repoRoot);
    await summary.refresh({ remote: "never" });
  }, [isOpen, summary]);

  useEffect(() => {
    if (!isOpen) {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    if (summary.isLoading && !summary.hasRepo && !summary.status) {
      setPanelState("loading");
      return;
    }
    if (!summary.hasRepo) {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("no-repo");
      setSelectionTransition("none");
      return;
    }
    if (summary.localError && !summary.status) {
      setRepo(summary.repo);
      setStatus(null);
      setSelected(null);
      setPanelState("error");
      setSelectionTransition("none");
      return;
    }
    if (!summary.repo || !summary.status) {
      if (summary.isLoading) {
        setPanelState("loading");
      }
      return;
    }

    setRepo(summary.repo);
    setStatus(summary.status);
    setPanelState("ready");

    const current = selectedRef.current;
    const exists =
      !!current &&
      summary.status.changedFiles.some((file) => {
        if (file.path !== current.path) return false;
        return current.mode === "+" ? file.staged : file.unstaged;
      });

    if (!exists && current) {
      const samePathOtherMode = summary.status.changedFiles.find(
        (file) =>
          file.path === current.path &&
          (current.mode === "+" ? file.unstaged : file.staged),
      );
      if (samePathOtherMode) {
        const moved: DiffSelection = {
          path: samePathOtherMode.path,
          mode: current.mode === "+" ? "-" : "+",
        };
        setSelected(moved);
        openSelection(moved, summary.repo.repoRoot, samePathOtherMode);
        setSelectionTransition("moved-group");
      } else {
        setSelected(null);
        setSelectionTransition("reset");
      }
    } else {
      setSelectionTransition("none");
    }
  }, [
    isOpen,
    summary.hasRepo,
    summary.isLoading,
    summary.localError,
    summary.repo,
    summary.status,
    openSelection,
  ]);

  const selectEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const nextSelection: DiffSelection = {
        path: entry.path,
        mode: entry.mode,
      };
      if (sameSelection(selected, nextSelection)) {
        setActionError(null);
        setActionMessage(null);
        setSelectionTransition("none");
        return;
      }
      setSelected(nextSelection);
      setActionError(null);
      setActionMessage(null);
      setSelectionTransition("none");
      const file = status?.changedFiles.find((c) => c.path === entry.path);
      openSelection(nextSelection, repo.repoRoot, file);
    },
    [openSelection, repo, selected, status],
  );

  const runMutation = useCallback(
    async (
      busyKey: string,
      optimistic: ((status: GitStatusSnapshot) => GitStatusSnapshot) | null,
      ipc: () => Promise<void>,
      affected: string[],
      afterSuccess?: () => void,
    ) => {
      if (!repo || summary.busyAction) return;
      setLocalActionBusy(busyKey);
      setActionMessage(null);
      setActionError(null);
      if (optimistic) summary.applyStatus(optimistic);
      for (const path of affected) {
        invalidateDiff(workingDiffKey(repo.repoRoot, path, "+"));
        invalidateDiff(workingDiffKey(repo.repoRoot, path, "-"));
      }
      try {
        await ipc();
        afterSuccess?.();
        scheduleReconcile();
      } catch (error) {
        setActionError(normalizeError(error));
        cancelReconcile();
        await summary.refresh({ remote: "never" }).catch(() => {});
      } finally {
        setLocalActionBusy(null);
      }
    },
    [cancelReconcile, repo, scheduleReconcile, summary],
  );

  const stageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const paths = new Set([entry.path]);
      await runMutation(
        `stage:${entry.path}`,
        (s) => optimisticStage(s, paths),
        () => native.gitStage(repo.repoRoot, [entry.path]),
        [entry.path],
        () =>
          setMarkedEntryKeys((current) => {
            const key = entrySelectionKey(entry);
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          }),
      );
    },
    [repo, runMutation],
  );

  const unstageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const paths = new Set([entry.path]);
      await runMutation(
        `unstage:${entry.path}`,
        (s) => optimisticUnstage(s, paths),
        () => native.gitUnstage(repo.repoRoot, [entry.path]),
        [entry.path],
        () =>
          setMarkedEntryKeys((current) => {
            const key = entrySelectionKey(entry);
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          }),
      );
    },
    [repo, runMutation],
  );

  const toggleMarkedEntry = useCallback((entry: SourceControlEntry) => {
    const key = entrySelectionKey(entry);
    setMarkedEntryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearMarkedEntries = useCallback(() => {
    setMarkedEntryKeys((current) => (current.size === 0 ? current : new Set()));
  }, []);

  const runSectionMutation = useCallback(
    async (section: SourceControlSection, action: "stage" | "unstage") => {
      if (!repo) return;
      const sourceEntries =
        section === "unstaged" ? unstagedEntries : stagedEntries;
      const entries = resolveSectionBatchEntries(sourceEntries, markedEntryKeys);
      if (entries.length === 0) return;
      const paths = new Set(entries.map((entry) => entry.path));
      const keys = entries.map(entrySelectionKey);
      await runMutation(
        `${action}:${section}`,
        action === "stage"
          ? (s) => optimisticStage(s, paths)
          : (s) => optimisticUnstage(s, paths),
        () =>
          action === "stage"
            ? native.gitStage(repo.repoRoot, [...paths])
            : native.gitUnstage(repo.repoRoot, [...paths]),
        [...paths],
        () =>
          setMarkedEntryKeys((current) => {
            let changed = false;
            const next = new Set(current);
            for (const key of keys) {
              if (next.delete(key)) changed = true;
            }
            return changed ? next : current;
          }),
      );
    },
    [markedEntryKeys, repo, runMutation, stagedEntries, unstagedEntries],
  );

  const stageSectionEntries = useCallback(
    async (section: SourceControlSection) => {
      if (section !== "unstaged") return;
      await runSectionMutation("unstaged", "stage");
    },
    [runSectionMutation],
  );

  const unstageSectionEntries = useCallback(
    async (section: SourceControlSection) => {
      if (section !== "staged") return;
      await runSectionMutation("staged", "unstage");
    },
    [runSectionMutation],
  );

  const requestDiscardEntry = useCallback(
    (entry: SourceControlEntry) => {
      if (!repo || summary.busyAction) return;
      setPendingDiscard({ scope: "single", entry });
    },
    [repo, summary.busyAction],
  );

  const requestDiscardAll = useCallback(() => {
    if (!repo || summary.busyAction || unstagedEntries.length === 0) return;
    const entries = resolveSectionBatchEntries(unstagedEntries, markedEntryKeys);
    if (entries.length === 0) return;
    setPendingDiscard({ scope: "all", entries });
  }, [markedEntryKeys, repo, summary.busyAction, unstagedEntries]);

  const cancelPendingDiscard = useCallback(() => {
    setPendingDiscard(null);
  }, []);

  const confirmPendingDiscard = useCallback(async () => {
    if (!repo || !pendingDiscard) return;
    const list =
      pendingDiscard.scope === "single"
        ? [pendingDiscard.entry]
        : pendingDiscard.entries;
    setPendingDiscard(null);
    const entries: GitDiscardEntry[] = list.map((entry) => ({
      path: entry.path,
      untracked: entry.untracked,
    }));
    const paths = new Set(list.map((entry) => entry.path));
    const keys = list.map(entrySelectionKey);
    await runMutation(
      pendingDiscard.scope === "single"
        ? `discard:${list[0].path}`
        : "discard:all",
      (s) => optimisticDiscard(s, paths),
      () => native.gitDiscard(repo.repoRoot, entries),
      [...paths],
      () =>
        setMarkedEntryKeys((current) => {
          let changed = false;
          const next = new Set(current);
          for (const key of keys) {
            if (next.delete(key)) changed = true;
          }
          return changed ? next : current;
        }),
    );
  }, [pendingDiscard, repo, runMutation]);

  const stageAllEntries = useCallback(async () => {
    if (!repo || unstagedEntries.length === 0) return;
    const paths = new Set(unstagedEntries.map((entry) => entry.path));
    await runMutation(
      "stage:all",
      (s) => optimisticStage(s, paths),
      () => native.gitStage(repo.repoRoot, [...paths]),
      [...paths],
    );
  }, [repo, runMutation, unstagedEntries]);

  const unstageAllEntries = useCallback(async () => {
    if (!repo || stagedEntries.length === 0) return;
    const paths = new Set(stagedEntries.map((entry) => entry.path));
    await runMutation(
      "unstage:all",
      (s) => optimisticUnstage(s, paths),
      () => native.gitUnstage(repo.repoRoot, [...paths]),
      [...paths],
    );
  }, [repo, runMutation, stagedEntries]);

  const selectFile = useCallback(
    async (entry: SourceControlFileEntry) => {
      if (!repo) return;
      const mode: DiffMode = entry.unstaged ? "-" : "+";
      const nextSelection: DiffSelection = { path: entry.path, mode };
      if (sameSelection(selected, nextSelection)) {
        setActionError(null);
        setActionMessage(null);
        setSelectionTransition("none");
        return;
      }
      setSelected(nextSelection);
      setActionError(null);
      setActionMessage(null);
      setSelectionTransition("none");
      const file = status?.changedFiles.find((c) => c.path === entry.path);
      openSelection(nextSelection, repo.repoRoot, file);
    },
    [openSelection, repo, selected, status],
  );

  const requestDiscardFile = useCallback(
    (entry: SourceControlFileEntry) => {
      if (!repo || summary.busyAction) return;
      setPendingDiscard({
        scope: "single",
        entry: {
          key: `-:${entry.path}`,
          path: entry.path,
          mode: "-",
          indexStatus: " ",
          worktreeStatus: entry.statusCode,
          statusLabel: entry.statusLabel,
          statusCode: entry.statusCode,
          originalPath: entry.originalPath,
          untracked: entry.untracked,
        },
      });
    },
    [repo, summary.busyAction],
  );

  const generateCommitMessage = useCallback(async () => {
    if (!repo || stagedEntries.length === 0) return;
    if (aiBusy) {
      setActionError("Wait for the current AI action to finish");
      return;
    }
    if (aiUnavailableReason) {
      setActionError(aiUnavailableReason);
      return;
    }
    setLocalActionBusy("generate-message");
    setActionMessage(null);
    setActionError(null);
    try {
      const [{ buildConfiguredLanguageModel }, { generateText }, diff] =
        await Promise.all([
          import("@/modules/ai/lib/agent"),
          import("ai"),
          native.gitDiff(repo.repoRoot, null, true),
        ]);
      const { text: diffText, truncated } = truncateDiff(diff.diffText);
      const chatState = useChatStore.getState();
      const prefs = usePreferencesStore.getState();
      const model = await buildConfiguredLanguageModel(
        selectedModelId,
        chatState.apiKeys,
        {
          lmstudioBaseURL: prefs.lmstudioBaseURL,
          lmstudioModelId,
          mlxBaseURL: prefs.mlxBaseURL,
          mlxModelId,
          ollamaBaseURL: prefs.ollamaBaseURL,
          ollamaModelId,
          openaiCompatibleBaseURL,
          openaiCompatibleModelId,
          openrouterModelId,
        },
      );
      const result = await generateText({
        model,
        system: COMMIT_MESSAGE_SYSTEM_PROMPT,
        prompt: buildCommitMessagePrompt(stagedEntries, diffText, truncated),
        maxOutputTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      });
      let message = cleanCommitMessage(result.text);
      if (!isValidCommitMessage(message)) {
        const repair = await generateText({
          model,
          system: COMMIT_MESSAGE_SYSTEM_PROMPT,
          prompt: buildRepairCommitMessagePrompt(message, stagedEntries),
          maxOutputTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
          temperature: 0,
        });
        message = cleanCommitMessage(repair.text);
      }
      if (!isValidCommitMessage(message)) {
        throw new Error(
          "AI returned an invalid commit message. Try again or switch models.",
        );
      }
      updateCommitMessage(message);
      setActionMessage(null);
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [
    aiUnavailableReason,
    aiBusy,
    lmstudioModelId,
    mlxModelId,
    ollamaModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    openrouterModelId,
    repo,
    selectedModelId,
    stagedEntries,
    updateCommitMessage,
  ]);

  const runCommitAction = useCallback(async (
    mode: "commit" | "commit-push" | "commit-sync",
  ) => {
    if (!repo || summary.busyAction) return;
    setLocalActionBusy(mode);
    setActionMessage(null);
    setActionError(null);
    let didCommit = false;
    try {
      const result = await native.gitCommit(repo.repoRoot, commitMessage);
      didCommit = true;
      setCommitMessage("");
      setCommitSucceeded(true);
      setActionMessage(
        `Committed ${result.commitSha.slice(0, 7)} ${result.summary}`,
      );
      invalidateRepoDiffs(repo.repoRoot);
      if (mode === "commit-sync") {
        await native.gitFetch(repo.repoRoot);
      }
      if (mode === "commit-push" || mode === "commit-sync") {
        await native.gitPush(repo.repoRoot);
        setActionMessage(
          status?.upstream
            ? `Committed and pushed to ${status.upstream}`
            : "Committed and pushed",
        );
      }
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
      setCommitSucceeded(didCommit);
      await summary.refresh({ remote: "never" }).catch(() => {});
    } finally {
      setLocalActionBusy(null);
    }
  }, [commitMessage, repo, status?.upstream, summary]);

  const commit = useCallback(async () => {
    await runCommitAction("commit");
  }, [runCommitAction]);

  const commitAndPush = useCallback(async () => {
    await runCommitAction("commit-push");
  }, [runCommitAction]);

  const commitAndSync = useCallback(async () => {
    await runCommitAction("commit-sync");
  }, [runCommitAction]);

  const push = useCallback(async () => {
    if (!repo) return;
    setActionMessage(null);
    setActionError(null);
    const result = await summary.runRemoteAction("push");
    if (result.ok) {
      setActionMessage(
        status?.upstream ? `Pushed to ${status.upstream}` : "Push completed",
      );
      return;
    }
    if (result.error) {
      setActionError(result.error);
    }
  }, [repo, status?.upstream, summary]);

  const pendingDiscardView = useMemo<PendingDiscard | null>(() => {
    if (!pendingDiscard) return null;
    if (pendingDiscard.scope === "single") {
      return {
        scope: "single",
        count: 1,
        label: pendingDiscard.entry.path,
      };
    }
    return {
      scope: "all",
      count: pendingDiscard.entries.length,
      label: `${pendingDiscard.entries.length} unstaged ${
        pendingDiscard.entries.length === 1 ? "file" : "files"
      }`,
    };
  }, [pendingDiscard]);

  return {
    panelState,
    repo,
    status,
    selected,
    commitMessage,
    commitSucceeded,
    actionBusy: localActionBusy ?? summary.busyAction,
    statusError: summary.localError,
    actionError,
    remoteError: summary.lastRemoteError,
    actionMessage,
    stagedEntries,
    unstagedEntries,
    fileEntries,
    headerCheckState,
    markedEntryKeys: markedKeyList,
    allClean,
    canPush,
    pushHint,
    canGenerateCommitMessage,
    generateCommitMessageHint,
    selectionTransition,
    stagedEmptyText,
    unstagedEmptyText,
    pendingDiscard: pendingDiscardView,
    setCommitMessage: updateCommitMessage,
    refresh,
    selectEntry,
    selectFile,
    stageEntry,
    unstageEntry,
    toggleMarkedEntry,
    clearMarkedEntries,
    stageSectionEntries,
    unstageSectionEntries,
    requestDiscardEntry,
    requestDiscardFile,
    requestDiscardAll,
    confirmPendingDiscard,
    cancelPendingDiscard,
    stageAllEntries,
    unstageAllEntries,
    generateCommitMessage,
    commit,
    commitAndPush,
    commitAndSync,
    push,
  };
}
