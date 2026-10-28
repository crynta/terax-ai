import {
  native,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { useWorkspaceEnvStore, workspaceScopeKey } from "@/modules/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const AUTO_FETCH_THROTTLE_MS = 5 * 60_000;
const AUTO_FETCH_LRU_LIMIT = 16;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 1500;
// Skip the context-change refetch when the data is this fresh and the new path
// is still inside the loaded repo (cd-within-repo produces identical status).
const SC_STATUS_TTL_MS = 2000;

type SourceControlRefreshMode = "auto" | "always" | "never";
type SourceControlRemoteAction = "fetch" | "pull" | "push";
type SourceControlRemoteActionMode =
  | "contextual"
  | SourceControlRemoteAction;

type SourceControlRemoteActionResult = {
  ok: boolean;
  action: SourceControlRemoteAction | null;
  error?: string;
  blocked?: "diverged" | "missing-upstream" | "no-repo";
};

export type SourceControlSummary = {
  contextPath: string | null;
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
  applyStatus: (
    updater: (status: GitStatusSnapshot) => GitStatusSnapshot,
  ) => void;
  refresh: (options?: {
    remote?: SourceControlRefreshMode;
  }) => Promise<void>;
  runRemoteAction: (
    mode?: SourceControlRemoteActionMode,
  ) => Promise<SourceControlRemoteActionResult>;
};

type SourceControlSummaryState = {
  contextPath: string | null;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  hasRepo: boolean;
  isLoading: boolean;
  localError: string | null;
  busyAction: SourceControlRemoteAction | null;
  lastRemoteError: string | null;
};

type RefreshableSourceControlState = Pick<
  SourceControlSummaryState,
  | "contextPath"
  | "repo"
  | "status"
  | "hasRepo"
  | "isLoading"
  | "localError"
  | "lastRemoteError"
>;

const EMPTY_STATE: SourceControlSummaryState = {
  contextPath: null,
  repo: null,
  status: null,
  hasRepo: false,
  isLoading: false,
  localError: null,
  busyAction: null,
  lastRemoteError: null,
};

type InflightRefresh = {
  contextKey: string;
  mode: SourceControlRefreshMode;
  promise: Promise<void>;
};

function sourceControlContextKey(
  workspaceKey: string,
  contextPath: string | null,
): string {
  return `${workspaceKey}\0${contextPath ?? ""}`;
}

function normalizedContextPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/, "");
}

export function repositoryContainsContext(
  repoRoot: string | null,
  contextPath: string | null,
): boolean {
  if (!repoRoot || !contextPath) return false;
  let root = normalizedContextPath(repoRoot);
  let context = normalizedContextPath(contextPath);
  const windowsPaths =
    (/^[A-Za-z]:\//.test(root) && /^[A-Za-z]:\//.test(context)) ||
    (root.startsWith("//") && context.startsWith("//"));
  if (windowsPaths) {
    root = root.toLowerCase();
    context = context.toLowerCase();
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return context === root || context.startsWith(prefix);
}

type ContextRefreshPlan =
  /** Disabled: drop everything. */
  | "reset"
  /** Run `git status` for the new context. */
  | "refresh"
  /** Fresh data already covers this context: just record the new path. */
  | "reuse"
  /** Nobody is looking and the loaded repo no longer applies: drop it, no git. */
  | "clear"
  /** Nobody is looking: leave the loaded snapshot alone, no git. */
  | "keep";

/**
 * What a context change (or a consumer appearing) should do.
 *
 * While no live consumer is on screen (`live` false) git is never run: the
 * snapshot is only kept if it still describes the repository the context is in,
 * because a rail badge showing another repo's change count is worse than none.
 * When a consumer appears the same decision runs with `live` true, so stale
 * data is refreshed on open instead of in the background.
 */
export function planContextRefresh(input: {
  enabled: boolean;
  live: boolean;
  contextPath: string | null;
  repoRoot: string | null;
  hasRepo: boolean;
  /** Milliseconds since the last completed refresh. */
  ageMs: number;
}): ContextRefreshPlan {
  if (!input.enabled) return "reset";
  const sameRepo = repositoryContainsContext(input.repoRoot, input.contextPath);
  if (!input.live) {
    if (!input.hasRepo && input.repoRoot === null) return "keep";
    return sameRepo ? "keep" : "clear";
  }
  if (input.ageMs < SC_STATUS_TTL_MS && sameRepo && input.hasRepo) {
    return "reuse";
  }
  return "refresh";
}

export function beginSourceControlRefresh<
  T extends RefreshableSourceControlState,
>(current: T, contextPath: string, reuseCurrentRepository: boolean): T {
  return {
    ...current,
    contextPath,
    repo: reuseCurrentRepository ? current.repo : null,
    status: reuseCurrentRepository ? current.status : null,
    hasRepo: reuseCurrentRepository ? current.hasRepo : false,
    isLoading: true,
    localError: null,
    lastRemoteError: reuseCurrentRepository ? current.lastRemoteError : null,
  };
}

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

function touchAutoFetch(map: Map<string, number>, key: string): void {
  map.delete(key);
  map.set(key, Date.now());
  while (map.size > AUTO_FETCH_LRU_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export type UseSourceControlOptions = {
  /**
   * A live consumer (Source Control panel, git tab, explorer decorations) is on
   * screen. While false the hook runs no `git status` on window focus or when
   * the context changes; it refreshes once a consumer appears. Default true.
   */
  live?: boolean;
};

export function useSourceControl(
  contextPath: string | null,
  enabled: boolean = true,
  { live = true }: UseSourceControlOptions = {},
): SourceControlSummary {
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const workspaceKey = workspaceScopeKey(workspaceEnv);
  const [state, setState] = useState<SourceControlSummaryState>({
    contextPath: null,
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
  const inflightRef = useRef<InflightRefresh | null>(null);
  const autoFetchByRepoRef = useRef(new Map<string, number>());
  const enabledRef = useRef(enabled);
  const lastRefreshAtRef = useRef(0);
  const resetWorkspaceKeyRef = useRef(workspaceKey);
  const contextKey = sourceControlContextKey(workspaceKey, contextPath);
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (resetWorkspaceKeyRef.current === workspaceKey) return;
    resetWorkspaceKeyRef.current = workspaceKey;
    requestIdRef.current++;
    inflightRef.current = null;
    autoFetchByRepoRef.current.clear();
    setState({
      contextPath: null,
      repo: null,
      status: null,
      hasRepo: false,
      isLoading: false,
      localError: null,
      busyAction: null,
      lastRemoteError: null,
    });
  }, [workspaceKey]);

  const applyStatus = useCallback(
    (updater: (status: GitStatusSnapshot) => GitStatusSnapshot) => {
      setState((current) => {
        if (!current.status) return current;
        const next = updater(current.status);
        if (next === current.status) return current;
        return { ...current, status: next };
      });
    },
    [],
  );

  const doRefresh = useCallback(
    async (remoteMode: SourceControlRefreshMode): Promise<void> => {
      const refreshContextKey = contextKey;
      if (
        !enabledRef.current ||
        refreshContextKey !== contextKeyRef.current
      ) {
        return;
      }
      const requestId = ++requestIdRef.current;
      const isCurrentRequest = () =>
        requestId === requestIdRef.current &&
        refreshContextKey === contextKeyRef.current;

      if (!contextPath) {
        if (!isCurrentRequest()) return;
        setState({
          contextPath: null,
          repo: null,
          status: null,
          hasRepo: false,
          isLoading: false,
          localError: null,
          busyAction: null,
          lastRemoteError: null,
        });
        return;
      }

      const activeRoot = stateRef.current.repo?.repoRoot ?? null;
      const reusableRoot = repositoryContainsContext(activeRoot, contextPath)
        ? activeRoot
        : null;

      setState((current) =>
        beginSourceControlRefresh(current, contextPath, !!reusableRoot),
      );

      try {
        let repo: GitRepoInfo | null;
        let status: GitStatusSnapshot | null;

        if (reusableRoot) {
          try {
            repo = stateRef.current.repo ?? null;
            status = await native.gitStatus(reusableRoot);
            if (!isCurrentRequest()) return;
            if (!repo || repo.repoRoot !== reusableRoot) {
              repo = {
                repoRoot: reusableRoot,
                branch: status.branch,
                upstream: status.upstream,
                isDetached: status.isDetached,
              };
            }
          } catch {
            const snapshot = await native.gitPanelSnapshot(contextPath);
            if (!isCurrentRequest()) return;
            if (!snapshot.repo) {
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
            repo = snapshot.repo;
            status = snapshot.status ?? null;
          }
        } else {
          const snapshot = await native.gitPanelSnapshot(contextPath);
          if (!isCurrentRequest()) return;
          if (!snapshot.repo) {
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
          repo = snapshot.repo;
          status = snapshot.status ?? null;
        }

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
            touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
            nextRemoteError = null;
            if (!isCurrentRequest()) return;
            status = await native.gitStatus(repo.repoRoot);
            if (!isCurrentRequest()) return;
          } catch (error) {
            nextRemoteError = normalizeError(error);
          }
        }

        if (!isCurrentRequest()) return;
        setState((current) => ({
          ...current,
          repo,
          status,
          hasRepo: true,
          isLoading: false,
          localError: null,
          lastRemoteError: nextRemoteError,
        }));
      } catch (error) {
        if (!isCurrentRequest()) return;
        setState((current) => ({
          ...current,
          repo: null,
          hasRepo: false,
          status: null,
          isLoading: false,
          localError: normalizeError(error),
        }));
      } finally {
        if (isCurrentRequest()) {
          lastRefreshAtRef.current = Date.now();
        }
      }
    },
    [contextKey, contextPath],
  );

  const refresh = useCallback(
    async (options?: { remote?: SourceControlRefreshMode }) => {
      const remoteMode = options?.remote ?? "never";
      const inflight = inflightRef.current;
      if (inflight?.contextKey === contextKey) {
        const cur = inflight.mode;
        const upgrade =
          (cur === "never" && remoteMode !== "never") ||
          (cur === "auto" && remoteMode === "always");
        if (!upgrade) return inflight.promise;
      }
      const run = doRefresh(remoteMode).finally(() => {
        if (inflightRef.current?.promise === run) {
          inflightRef.current = null;
        }
      });
      inflightRef.current = { contextKey, mode: remoteMode, promise: run };
      return run;
    },
    [contextKey, doRefresh],
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

      const action = mode === "contextual" ? getContextualAction(status) : mode;
      if (!action) {
        return { ok: false, action: null, blocked: "diverged" };
      }

      setState((current) => ({ ...current, busyAction: action }));
      const actionContextKey = contextKeyRef.current;
      const isCurrentContext = () =>
        actionContextKey === contextKeyRef.current;

      try {
        if (action === "fetch") {
          await native.gitFetch(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
        } else if (action === "pull") {
          await native.gitFetch(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
          await native.gitPullFfOnly(repo.repoRoot);
        } else {
          await native.gitPush(repo.repoRoot);
        }
        if (isCurrentContext()) {
          setState((current) => ({ ...current, lastRemoteError: null }));
          await refresh({ remote: "never" });
        }
        return { ok: true, action };
      } catch (error) {
        const message = normalizeError(error);
        if (isCurrentContext()) {
          setState((current) => ({ ...current, lastRemoteError: message }));
          await refresh({ remote: "never" }).catch(() => {});
        }
        return { ok: false, action, error: message };
      } finally {
        setState((current) => ({ ...current, busyAction: null }));
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current++;
      setState(EMPTY_STATE);
      return;
    }
    setState((current) => ({ ...current, lastRemoteError: null }));
    const run = () => {
      const current = stateRef.current;
      const plan = planContextRefresh({
        enabled,
        live,
        contextPath,
        repoRoot: current.repo?.repoRoot ?? null,
        hasRepo: current.hasRepo,
        ageMs: Date.now() - lastRefreshAtRef.current,
      });
      switch (plan) {
        case "refresh":
          void refresh({ remote: "never" });
          return;
        case "reuse":
          setState((s) =>
            s.contextPath === contextPath ? s : { ...s, contextPath },
          );
          return;
        case "clear":
          // Drop any refresh still in flight for the context we just left.
          requestIdRef.current++;
          setState(EMPTY_STATE);
          return;
        default:
          return;
      }
    };
    // A consumer that is on screen with nothing to show (a freshly opened
    // panel after a snapshot was dropped) must not wait for an idle slot, or it
    // would flash "no repository" first.
    const current = stateRef.current;
    if (live && contextPath && !current.hasRepo && !current.isLoading) {
      run();
      return;
    }
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(run, { timeout: 600 })
        : (window.setTimeout(run, 0) as unknown as number);
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        try {
          window.cancelIdleCallback(idle as number);
        } catch {
          /* noop */
        }
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [refresh, contextPath, enabled, live]);

  useEffect(() => {
    if (!enabled || !live) return;
    let timer = 0;
    const onFocus = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        const elapsed = Date.now() - lastRefreshAtRef.current;
        if (elapsed < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
        void refresh({ remote: "never" });
      }, 400);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer) window.clearTimeout(timer);
    };
  }, [refresh, enabled, live]);

  return useMemo<SourceControlSummary>(
    () => ({
      contextPath: state.contextPath,
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
      applyStatus,
      refresh,
      runRemoteAction,
    }),
    [state, applyStatus, refresh, runRemoteAction],
  );
}
