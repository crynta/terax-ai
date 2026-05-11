import {
  native,
  type GitChangedFile,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PanelState = "closed" | "loading" | "no-repo" | "ready" | "error";
type DiffMode = "+" | "-";

export type DiffSelection = {
  path: string;
  mode: DiffMode;
};

export type SourceControlEntry = {
  key: string;
  path: string;
  mode: DiffMode;
  statusLabel: string;
  originalPath: string | null;
  untracked: boolean;
};

type SourceControlState = {
  panelState: PanelState;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  selected: DiffSelection | null;
  diffLoading: boolean;
  commitMessage: string;
  actionBusy: string | null;
  error: string | null;
  actionMessage: string | null;
  stagedEntries: SourceControlEntry[];
  unstagedEntries: SourceControlEntry[];
  setCommitMessage: (value: string) => void;
  refresh: () => Promise<void>;
  selectEntry: (entry: SourceControlEntry) => Promise<void>;
  stageEntry: (entry: SourceControlEntry) => Promise<void>;
  unstageEntry: (entry: SourceControlEntry) => Promise<void>;
  stageAllEntries: () => Promise<void>;
  unstageAllEntries: () => Promise<void>;
  commit: () => Promise<void>;
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

function makeEntry(
  path: string,
  mode: DiffMode,
  file: GitChangedFile,
): SourceControlEntry {
  return {
    key: `${mode}:${path}`,
    path,
    mode,
    statusLabel: file.statusLabel,
    originalPath: file.originalPath,
    untracked: file.untracked,
  };
}

function sameSelection(
  a: DiffSelection | null,
  b: DiffSelection | null,
): boolean {
  return !!a && !!b && a.path === b.path && a.mode === b.mode;
}

function firstEntry(
  status: GitStatusSnapshot | null,
): SourceControlEntry | null {
  if (!status) return null;
  for (const file of status.changedFiles) {
    if (file.unstaged) return makeEntry(file.path, "-", file);
  }
  for (const file of status.changedFiles) {
    if (file.staged) return makeEntry(file.path, "+", file);
  }
  return null;
}

export function useSourceControl(
  isOpen: boolean,
  contextPath: string | null,
  onOpenDiff:
    | ((input: {
        path: string;
        repoRoot: string;
        mode: DiffMode;
        originalContent: string;
        modifiedContent: string;
        isBinary: boolean;
        fallbackPatch: string;
      }) => void)
    | null,
): SourceControlState {
  const [panelState, setPanelState] = useState<PanelState>("closed");
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [selected, setSelected] = useState<DiffSelection | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const selectedRef = useRef<DiffSelection | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const stagedEntries = useMemo(
    () =>
      (status?.changedFiles ?? [])
        .filter((file) => file.staged)
        .map((file) => makeEntry(file.path, "+", file)),
    [status],
  );

  const unstagedEntries = useMemo(
    () =>
      (status?.changedFiles ?? [])
        .filter((file) => file.unstaged)
        .map((file) => makeEntry(file.path, "-", file)),
    [status],
  );

  const loadDiff = useCallback(
    async (
      repoRoot: string,
      nextSelection: DiffSelection,
      currentStatus: GitStatusSnapshot | null,
    ) => {
      setDiffLoading(true);
      try {
        const file = currentStatus?.changedFiles.find(
          (candidate) => candidate.path === nextSelection.path,
        );
        const result = await native.gitDiffContent(
          repoRoot,
          nextSelection.path,
          nextSelection.mode === "+",
        );
        if (
          !result.fallbackPatch &&
          nextSelection.mode === "-" &&
          file?.untracked
        ) {
          onOpenDiff?.({
            path: nextSelection.path,
            repoRoot,
            mode: nextSelection.mode,
            originalContent: "",
            modifiedContent: result.modifiedContent,
            isBinary: result.isBinary,
            fallbackPatch: `Untracked file: ${nextSelection.path}\n\nStage the file to compare it against the index.`,
          });
          return;
        }
        onOpenDiff?.({
          path: nextSelection.path,
          repoRoot,
          mode: nextSelection.mode,
          originalContent: result.originalContent,
          modifiedContent: result.modifiedContent,
          isBinary: result.isBinary,
          fallbackPatch: result.fallbackPatch,
        });
      } catch (err) {
        setError(normalizeError(err));
      } finally {
        setDiffLoading(false);
      }
    },
    [onOpenDiff],
  );

  const refresh = useCallback(async () => {
    if (!isOpen) {
      setPanelState("closed");
      return;
    }
    if (!contextPath) {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("no-repo");
      return;
    }
    setPanelState("loading");
    setError(null);
    try {
      const repoInfo = await native.gitResolveRepo(contextPath);
      if (!repoInfo) {
        setRepo(null);
        setStatus(null);
        setSelected(null);
        setPanelState("no-repo");
        return;
      }
      const snapshot = await native.gitStatus(repoInfo.repoRoot);
      setRepo(repoInfo);
      setStatus(snapshot);
      setPanelState("ready");

      let nextSelection = selectedRef.current;
      let shouldOpenDiff = false;
      const exists =
        !!nextSelection &&
        snapshot.changedFiles.some((file) => {
          if (file.path !== nextSelection?.path) return false;
          return nextSelection.mode === "+" ? file.staged : file.unstaged;
        });

      if (!exists) {
        const first = firstEntry(snapshot);
        nextSelection = first ? { path: first.path, mode: first.mode } : null;
        setSelected(nextSelection);
        shouldOpenDiff = nextSelection !== null;
      }

      if (shouldOpenDiff && nextSelection) {
        await loadDiff(repoInfo.repoRoot, nextSelection, snapshot);
      }
    } catch (err) {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("error");
      setError(normalizeError(err));
    }
  }, [contextPath, isOpen, loadDiff]);

  useEffect(() => {
    void refresh();
  }, [contextPath, isOpen, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isOpen, refresh]);

  const selectEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const nextSelection = {
        path: entry.path,
        mode: entry.mode,
      } satisfies DiffSelection;
      if (sameSelection(selected, nextSelection)) {
        setError(null);
        setActionMessage(null);
        await loadDiff(repo.repoRoot, nextSelection, status);
        return;
      }
      setSelected(nextSelection);
      setError(null);
      setActionMessage(null);
      await loadDiff(repo.repoRoot, nextSelection, status);
    },
    [loadDiff, repo, selected, status],
  );

  const stageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      setActionBusy(`stage:${entry.path}`);
      setActionMessage(null);
      setError(null);
      try {
        await native.gitStage(repo.repoRoot, [entry.path]);
        await refresh();
      } catch (err) {
        setError(normalizeError(err));
      } finally {
        setActionBusy(null);
      }
    },
    [refresh, repo],
  );

  const unstageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      setActionBusy(`unstage:${entry.path}`);
      setActionMessage(null);
      setError(null);
      try {
        await native.gitUnstage(repo.repoRoot, [entry.path]);
        await refresh();
      } catch (err) {
        setError(normalizeError(err));
      } finally {
        setActionBusy(null);
      }
    },
    [refresh, repo],
  );

  const stageAllEntries = useCallback(async () => {
    if (!repo || unstagedEntries.length === 0) return;
    setActionBusy("stage:all");
    setActionMessage(null);
    setError(null);
    try {
      await native.gitStage(
        repo.repoRoot,
        unstagedEntries.map((entry) => entry.path),
      );
      await refresh();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionBusy(null);
    }
  }, [refresh, repo, unstagedEntries]);

  const unstageAllEntries = useCallback(async () => {
    if (!repo || stagedEntries.length === 0) return;
    setActionBusy("unstage:all");
    setActionMessage(null);
    setError(null);
    try {
      await native.gitUnstage(
        repo.repoRoot,
        stagedEntries.map((entry) => entry.path),
      );
      await refresh();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionBusy(null);
    }
  }, [refresh, repo, stagedEntries]);

  const commit = useCallback(async () => {
    if (!repo) return;
    setActionBusy("commit");
    setActionMessage(null);
    setError(null);
    try {
      const result = await native.gitCommit(repo.repoRoot, commitMessage);
      setCommitMessage("");
      setActionMessage(
        `Committed ${result.commitSha.slice(0, 7)} ${result.summary}`,
      );
      await refresh();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionBusy(null);
    }
  }, [commitMessage, refresh, repo]);

  const push = useCallback(async () => {
    if (!repo) return;
    setActionBusy("push");
    setActionMessage(null);
    setError(null);
    try {
      const result = await native.gitPush(repo.repoRoot);
      const target = [result.remote, result.branch].filter(Boolean).join("/");
      setActionMessage(target ? `Pushed to ${target}` : "Push completed");
      await refresh();
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionBusy(null);
    }
  }, [refresh, repo]);

  return {
    panelState,
    repo,
    status,
    selected,
    diffLoading,
    commitMessage,
    actionBusy,
    error,
    actionMessage,
    stagedEntries,
    unstagedEntries,
    setCommitMessage,
    refresh,
    selectEntry,
    stageEntry,
    unstageEntry,
    stageAllEntries,
    unstageAllEntries,
    commit,
    push,
  };
}
