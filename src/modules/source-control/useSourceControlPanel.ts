import {
  native,
  type GitChangedFile,
  type GitRepoInfo,
  type GitStatusSnapshot,
} from "@/modules/ai/lib/native";
import { buildConfiguredLanguageModel } from "@/modules/ai/lib/agent";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { getModel, providerNeedsKey } from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { generateText } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SourceControlSummary } from "./useSourceControl";

type PanelState = "closed" | "loading" | "no-repo" | "ready" | "error";
type DiffMode = "+" | "-";
type SelectionTransition = "none" | "moved-group" | "reset";

const COMPACT_PANEL_WIDTH = 380;
const COMMIT_DIFF_CHAR_LIMIT = 60_000;
const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 1024;
const CONVENTIONAL_PREFIX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?: .+/;
const COMMIT_MESSAGE_SYSTEM_PROMPT =
  "You write concise Conventional Commit subject lines in English. Return exactly one complete line, with no markdown, no quotes, no body, and no explanation.";

export type DiffSelection = {
  path: string;
  mode: DiffMode;
};

export type SourceControlEntry = {
  key: string;
  path: string;
  mode: DiffMode;
  indexStatus: string;
  worktreeStatus: string;
  statusLabel: string;
  statusCode: string;
  originalPath: string | null;
  untracked: boolean;
};

type SourceControlPanelState = {
  panelState: PanelState;
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
  selected: DiffSelection | null;
  diffLoading: boolean;
  commitMessage: string;
  actionBusy: string | null;
  statusError: string | null;
  actionError: string | null;
  remoteError: string | null;
  actionMessage: string | null;
  stagedEntries: SourceControlEntry[];
  unstagedEntries: SourceControlEntry[];
  allClean: boolean;
  compact: boolean;
  canPush: boolean;
  pushHint: string | null;
  canGenerateCommitMessage: boolean;
  generateCommitMessageHint: string;
  selectionTransition: SelectionTransition;
  stagedEmptyText: string;
  unstagedEmptyText: string;
  setCommitMessage: (value: string) => void;
  refresh: () => Promise<void>;
  selectEntry: (entry: SourceControlEntry) => Promise<void>;
  stageEntry: (entry: SourceControlEntry) => Promise<void>;
  unstageEntry: (entry: SourceControlEntry) => Promise<void>;
  discardEntry: (entry: SourceControlEntry) => Promise<void>;
  stageAllEntries: () => Promise<void>;
  unstageAllEntries: () => Promise<void>;
  discardAllEntries: () => Promise<void>;
  generateCommitMessage: () => Promise<void>;
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

function normalizeStatusCode(status: string): string {
  const code = status.trim().toUpperCase();
  switch (code) {
    case "?":
      return "?";
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
    case "C":
      return "R";
    case "U":
      return "U";
    default:
      return code || "M";
  }
}

function statusCodeForMode(mode: DiffMode, file: GitChangedFile): string {
  if (mode === "-" && file.untracked) return "?";
  const primary = mode === "+" ? file.indexStatus : file.worktreeStatus;
  const fallback = mode === "+" ? file.worktreeStatus : file.indexStatus;
  return normalizeStatusCode(primary !== " " ? primary : fallback);
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
    indexStatus: file.indexStatus,
    worktreeStatus: file.worktreeStatus,
    statusLabel: file.statusLabel,
    statusCode: statusCodeForMode(mode, file),
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
  return {
    text: diff.slice(0, COMMIT_DIFF_CHAR_LIMIT),
    truncated: true,
  };
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

export function useSourceControlPanel(
  isOpen: boolean,
  summary: SourceControlSummary,
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
  panelWidth = 0,
): SourceControlPanelState {
  const apiKeys = useChatStore((state) => state.apiKeys);
  const selectedModelId = useChatStore((state) => state.selectedModelId);
  const agentStatus = useChatStore((state) => state.agentMeta.status);
  const lmstudioBaseURL = usePreferencesStore((state) => state.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const [panelState, setPanelState] = useState<PanelState>("closed");
  const [repo, setRepo] = useState<GitRepoInfo | null>(null);
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [selected, setSelected] = useState<DiffSelection | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [localActionBusy, setLocalActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectionTransition, setSelectionTransition] =
    useState<SelectionTransition>("none");
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

  const compact = panelWidth > 0 && panelWidth < COMPACT_PANEL_WIDTH;
  const allClean = stagedEntries.length === 0 && unstagedEntries.length === 0;
  const canPush = !!status?.upstream && status.behind === 0;
  const selectedModel = getModel(selectedModelId);
  const aiBusy = agentStatus !== "idle" && agentStatus !== "error";
  const anyActionBusy = localActionBusy !== null || summary.busyAction !== null;
  const aiUnavailableReason = useMemo(() => {
    if (stagedEntries.length === 0) {
      return "Stage changes to generate a commit message";
    }
    if (
      providerNeedsKey(selectedModel.provider) &&
      !apiKeys[selectedModel.provider]
    ) {
      return "Connect an AI provider to generate commit messages";
    }
    if (selectedModel.id === "lmstudio-local" && !lmstudioModelId.trim()) {
      return "Connect an AI provider to generate commit messages";
    }
    if (
      selectedModel.id === "openai-compatible-custom" &&
      (!openaiCompatibleBaseURL.trim() || !openaiCompatibleModelId.trim())
    ) {
      return "Connect an AI provider to generate commit messages";
    }
    return null;
  }, [
    apiKeys,
    lmstudioModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
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
      } catch (error) {
        setActionError(normalizeError(error));
      } finally {
        setDiffLoading(false);
      }
    },
    [onOpenDiff],
  );

  const refresh = useCallback(async () => {
    if (!isOpen) {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    await summary.refresh({
      remote: summary.upstream ? "always" : "never",
    });
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

    let nextSelection = selectedRef.current;
    let shouldOpenDiff = false;
    let nextTransition: SelectionTransition = "none";
    const exists =
      !!nextSelection &&
      summary.status.changedFiles.some((file) => {
        if (file.path !== nextSelection?.path) return false;
        return nextSelection.mode === "+" ? file.staged : file.unstaged;
      });

    if (exists) {
      nextTransition = "none";
    } else if (nextSelection) {
      const samePathOtherMode = summary.status.changedFiles.find(
        (file) =>
          file.path === nextSelection?.path &&
          (nextSelection.mode === "+" ? file.unstaged : file.staged),
      );
      if (samePathOtherMode) {
        nextSelection = {
          path: samePathOtherMode.path,
          mode: nextSelection.mode === "+" ? "-" : "+",
        };
        setSelected(nextSelection);
        shouldOpenDiff = true;
        nextTransition = "moved-group";
      }
    }

    if (!exists && nextTransition === "none") {
      const first = firstEntry(summary.status);
      nextSelection = first ? { path: first.path, mode: first.mode } : null;
      setSelected(nextSelection);
      shouldOpenDiff = nextSelection !== null;
      nextTransition =
        selectedRef.current && !sameSelection(selectedRef.current, nextSelection)
          ? "reset"
          : "none";
    }

    setSelectionTransition(nextTransition);

    if (shouldOpenDiff && nextSelection) {
      void loadDiff(summary.repo.repoRoot, nextSelection, summary.status);
    }
  }, [
    isOpen,
    loadDiff,
    summary.hasRepo,
    summary.isLoading,
    summary.localError,
    summary.repo,
    summary.status,
  ]);

  const selectEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo) return;
      const nextSelection = {
        path: entry.path,
        mode: entry.mode,
      } satisfies DiffSelection;
      if (sameSelection(selected, nextSelection)) {
        setActionError(null);
        setActionMessage(null);
        setSelectionTransition("none");
        await loadDiff(repo.repoRoot, nextSelection, status);
        return;
      }
      setSelected(nextSelection);
      setActionError(null);
      setActionMessage(null);
      setSelectionTransition("none");
      await loadDiff(repo.repoRoot, nextSelection, status);
    },
    [loadDiff, repo, selected, status],
  );

  const stageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo || summary.busyAction) return;
      setLocalActionBusy(`stage:${entry.path}`);
      setActionMessage(null);
      setActionError(null);
      try {
        await native.gitStage(repo.repoRoot, [entry.path]);
        await summary.refresh({ remote: "never" });
      } catch (error) {
        setActionError(normalizeError(error));
      } finally {
        setLocalActionBusy(null);
      }
    },
    [repo, summary],
  );

  const unstageEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo || summary.busyAction) return;
      setLocalActionBusy(`unstage:${entry.path}`);
      setActionMessage(null);
      setActionError(null);
      try {
        await native.gitUnstage(repo.repoRoot, [entry.path]);
        await summary.refresh({ remote: "never" });
      } catch (error) {
        setActionError(normalizeError(error));
      } finally {
        setLocalActionBusy(null);
      }
    },
    [repo, summary],
  );

  const discardEntry = useCallback(
    async (entry: SourceControlEntry) => {
      if (!repo || summary.busyAction) return;
      const confirmed = window.confirm(`Discard changes in ${entry.path}?`);
      if (!confirmed) return;
      setLocalActionBusy(`discard:${entry.path}`);
      setActionMessage(null);
      setActionError(null);
      try {
        await native.gitDiscard(repo.repoRoot, [entry.path]);
        await summary.refresh({ remote: "never" });
      } catch (error) {
        setActionError(normalizeError(error));
      } finally {
        setLocalActionBusy(null);
      }
    },
    [repo, summary],
  );

  const stageAllEntries = useCallback(async () => {
    if (!repo || unstagedEntries.length === 0 || summary.busyAction) return;
    setLocalActionBusy("stage:all");
    setActionMessage(null);
    setActionError(null);
    try {
      await native.gitStage(
        repo.repoRoot,
        unstagedEntries.map((entry) => entry.path),
      );
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [repo, summary, unstagedEntries]);

  const unstageAllEntries = useCallback(async () => {
    if (!repo || stagedEntries.length === 0 || summary.busyAction) return;
    setLocalActionBusy("unstage:all");
    setActionMessage(null);
    setActionError(null);
    try {
      await native.gitUnstage(
        repo.repoRoot,
        stagedEntries.map((entry) => entry.path),
      );
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [repo, stagedEntries, summary]);

  const discardAllEntries = useCallback(async () => {
    if (!repo || unstagedEntries.length === 0 || summary.busyAction) return;
    const confirmed = window.confirm("Discard all unstaged changes?");
    if (!confirmed) return;
    setLocalActionBusy("discard:all");
    setActionMessage(null);
    setActionError(null);
    try {
      await native.gitDiscard(
        repo.repoRoot,
        unstagedEntries.map((entry) => entry.path),
      );
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [repo, summary, unstagedEntries]);

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
      const diff = await native.gitDiff(repo.repoRoot, null, true);
      const { text: diffText, truncated } = truncateDiff(diff.diffText);
      const model = await buildConfiguredLanguageModel(
        selectedModelId,
        apiKeys,
        lmstudioBaseURL,
        lmstudioModelId,
        openaiCompatibleBaseURL,
        openaiCompatibleModelId,
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
      setCommitMessage(message);
      setActionMessage(null);
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [
    aiUnavailableReason,
    apiKeys,
    aiBusy,
    lmstudioBaseURL,
    lmstudioModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
    repo,
    selectedModelId,
    stagedEntries,
  ]);

  const commit = useCallback(async () => {
    if (!repo || summary.busyAction) return;
    setLocalActionBusy("commit");
    setActionMessage(null);
    setActionError(null);
    try {
      const result = await native.gitCommit(repo.repoRoot, commitMessage);
      setCommitMessage("");
      setActionMessage(
        `Committed ${result.commitSha.slice(0, 7)} ${result.summary}`,
      );
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [commitMessage, repo, summary]);

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

  return {
    panelState,
    repo,
    status,
    selected,
    diffLoading,
    commitMessage,
    actionBusy: localActionBusy ?? summary.busyAction,
    statusError: summary.localError,
    actionError,
    remoteError: summary.lastRemoteError,
    actionMessage,
    stagedEntries,
    unstagedEntries,
    allClean,
    compact,
    canPush,
    pushHint,
    canGenerateCommitMessage,
    generateCommitMessageHint,
    selectionTransition,
    stagedEmptyText,
    unstagedEmptyText,
    setCommitMessage,
    refresh,
    selectEntry,
    stageEntry,
    unstageEntry,
    discardEntry,
    stageAllEntries,
    unstageAllEntries,
    discardAllEntries,
    generateCommitMessage,
    commit,
    push,
  };
}
