import {
  native,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_FETCH_THROTTLE_MS = 30_000;

export type SourceControlRefreshMode = "auto" | "always" | "never";
export type SourceControlRemoteAction = "fetch" | "pull" | "push";
export type SourceControlRemoteActionMode =
  | "contextual"
  | SourceControlRemoteAction;

export type SourceControlRemoteActionResult = {
  ok: boolean;
  action: SourceControlRemoteAction | null;
  error?: string;
  blocked?: "diverged" | "missing-upstream" | "no-repo";
};

export type SourceControlSummary = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  changedCount: number;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
  refresh: (options?: {
    remote?: SourceControlRefreshMode;
  }) => Promise<void>;
  runRemoteAction: (
    mode?: SourceControlRemoteActionMode,
  ) => Promise<SourceControlRemoteActionResult>;
};

export type SourceControlRemoteIndicator = {
  visible: boolean;
  label: string;
  title: string;
  disabled: boolean;
  action: SourceControlRemoteAction | null;
};

type SourceControlSummaryState = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown source control error";
}

function getContextualAction(
  status: GitStatusSnapshot | null,
): SourceControlRemoteAction | null {
  if (!status?.upstream) return null;
  if (status.ahead > 0 && status.behind > 0) return null;
  if (status.behind > 0) return "pull";
  if (status.ahead > 0) return "push";
  return "fetch";
}

export function getSourceControlRemoteIndicator(
  summary: Pick<
    SourceControlSummary,
    "hasRepo" | "upstream" | "ahead" | "behind" | "busyAction"
  >,
): SourceControlRemoteIndicator {
  if (!summary.hasRepo || !summary.upstream) {
    return {
      visible: false,
      label: "",
      title: "",
      disabled: true,
      action: null,
    };
  }

  if (summary.ahead > 0 && summary.behind > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead} ↓${summary.behind}`,
      title:
        "Branch has diverged from upstream. Use Source Control or the terminal to resolve it.",
      disabled: true,
      action: null,
    };
  }

  if (summary.behind > 0) {
    return {
      visible: true,
      label: `↓${summary.behind}`,
      title: `Pull ${summary.behind} remote ${
        summary.behind === 1 ? "commit" : "commits"
      } with fast-forward only.`,
      disabled: summary.busyAction !== null,
      action: "pull",
    };
  }

  if (summary.ahead > 0) {
    return {
      visible: true,
      label: `↑${summary.ahead}`,
      title: `Push ${summary.ahead} local ${
        summary.ahead === 1 ? "commit" : "commits"
      }.`,
      disabled: summary.busyAction !== null,
      action: "push",
    };
  }

  return {
    visible: true,
    label: "Sync",
    title: "Fetch remote updates.",
    disabled: summary.busyAction !== null,
    action: "fetch",
  };
}

export function useSourceControl(
  contextPath: string | null,
): SourceControlSummary {
  const [state, setState] = useState<SourceControlSummaryState>({
    repo: null,
    status: null,
    hasRepo: false,
    isLoading: false,
    localError: null,
    busyAction: null,
    lastRemoteError: null,
  });
  const stateRef = useRef(state);
  const requestIdRef = useRef(0);
  const autoFetchByRepoRef = useRef(new Map<string, number>());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(
    async (options?: { remote?: SourceControlRefreshMode }) => {
      const remoteMode = options?.remote ?? "auto";
      const requestId = ++requestIdRef.current;
      let resolvedRepo: GitRepoInfo | null = null;

      if (!contextPath) {
        setState({
          repo: null,
          status: null,
          hasRepo: false,
          isLoading: false,
          localError: null,
          busyAction: null,
          lastRemoteError: stateRef.current.lastRemoteError,
        });
        return;
      }

      setState((current) => ({
        ...current,
        isLoading: true,
        localError: null,
      }));

      try {
        const repo = await native.gitResolveRepo(contextPath);
        if (requestId !== requestIdRef.current) return;
        resolvedRepo = repo;

        if (!repo) {
          setState((current) => ({
            ...current,
            repo: null,
            status: null,
            hasRepo: false,
            isLoading: false,
            localError: null,
          }));
          return;
        }

        let nextRemoteError = stateRef.current.lastRemoteError;
        const shouldAutoFetch =
          repo.upstream &&
          remoteMode !== "never" &&
          (remoteMode === "always" ||
            Date.now() -
              (autoFetchByRepoRef.current.get(repo.repoRoot) ?? 0) >=
              AUTO_FETCH_THROTTLE_MS);

        if (shouldAutoFetch) {
          try {
            await native.gitFetch(repo.repoRoot);
            autoFetchByRepoRef.current.set(repo.repoRoot, Date.now());
            nextRemoteError = null;
          } catch (error) {
            nextRemoteError = normalizeError(error);
          }
        }

        const snapshot = await native.gitStatus(repo.repoRoot);
        if (requestId !== requestIdRef.current) return;

        setState((current) => ({
          ...current,
          repo,
          status: snapshot,
          hasRepo: true,
          isLoading: false,
          localError: null,
          lastRemoteError: nextRemoteError,
        }));
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const repo = resolvedRepo ?? stateRef.current.repo;
        setState((current) => ({
          ...current,
          repo,
          status: null,
          hasRepo: !!repo,
          isLoading: false,
          localError: normalizeError(error),
        }));
      }
    },
    [contextPath],
  );

  const runRemoteAction = useCallback(
    async (
      mode: SourceControlRemoteActionMode = "contextual",
    ): Promise<SourceControlRemoteActionResult> => {
      const { repo, status } = stateRef.current;
      if (!repo || !status) {
        return { ok: false, action: null, blocked: "no-repo" };
      }
      if (!status.upstream) {
        return { ok: false, action: null, blocked: "missing-upstream" };
      }

      const action =
        mode === "contextual" ? getContextualAction(status) : mode;
      if (!action) {
        return { ok: false, action: null, blocked: "diverged" };
      }

      setState((current) => ({
        ...current,
        busyAction: action,
      }));

      try {
        if (action === "fetch") {
          await native.gitFetch(repo.repoRoot);
          autoFetchByRepoRef.current.set(repo.repoRoot, Date.now());
        } else if (action === "pull") {
          await native.gitFetch(repo.repoRoot);
          autoFetchByRepoRef.current.set(repo.repoRoot, Date.now());
          await native.gitPullFfOnly(repo.repoRoot);
        } else {
          await native.gitPush(repo.repoRoot);
        }

        setState((current) => ({
          ...current,
          lastRemoteError: null,
        }));
        await refresh({ remote: "never" });
        return { ok: true, action };
      } catch (error) {
        const message = normalizeError(error);
        setState((current) => ({
          ...current,
          lastRemoteError: message,
        }));
        await refresh({ remote: "never" }).catch(() => {});
        return { ok: false, action, error: message };
      } finally {
        setState((current) => ({
          ...current,
          busyAction: null,
        }));
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh({ remote: "auto" });
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh({ remote: "auto" });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return {
    repo: state.repo,
    status: state.status,
    changedCount: state.status?.changedFiles.length ?? 0,
    upstream: state.status?.upstream ?? state.repo?.upstream ?? null,
    ahead: state.status?.ahead ?? 0,
    behind: state.status?.behind ?? 0,
    hasRepo: state.hasRepo,
    isLoading: state.isLoading,
    localError: state.localError,
    busyAction: state.busyAction,
    lastRemoteError: state.lastRemoteError,
    refresh,
    runRemoteAction,
  };
}
