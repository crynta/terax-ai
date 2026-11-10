import {
  leafCwd,
  leafTailText,
  liveLeafIds,
} from "@/modules/terminal/lib/terminalSessionApi";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import {
  buildChatContext,
  buildDiffContext,
  buildTerminalContext,
  CONTEXT_CAPS,
  type Mention,
  type SavedContext,
  type SpecialSources,
} from "./mentions";
import type { SessionPrompt } from "./promptSearch";
import { buildDocument } from "./transcript";
import { openTranscript, readTranscript } from "./transcriptClient";

export type PastChat = {
  sessionId: string;
  modifiedMs: number;
  size: number;
  title: string | null;
  /** A name set with Claude's `/rename`, when the transcript records one. */
  customTitle?: string | null;
  firstPrompt: string | null;
  /** Prompts typed in the session; null for transcripts too big to count. */
  turns?: number | null;
};

export type PromptMatch = { sessionId: string; snippet: string };

/** The first prompt per recent session of `cwd` that contains `query`. */
export function searchPastChats(
  cwd: string,
  query: string,
  limit = 20,
): Promise<PromptMatch[]> {
  return invoke<PromptMatch[]>("agent_transcript_search", {
    cwd,
    query,
    limit,
  });
}

/** Every prompt the user typed in session `sessionId`, oldest first. */
export function listSessionPrompts(sessionId: string): Promise<SessionPrompt[]> {
  return invoke<SessionPrompt[]>("agent_transcript_prompts", { sessionId });
}

/** Claude sessions recorded for `cwd`, newest first. */
export function listPastChats(cwd: string, limit = 30): Promise<PastChat[]> {
  return invoke<PastChat[]>("agent_transcript_list", { cwd, limit });
}

type RepoInfo = { repoRoot: string; branch: string };

const repoCache = new Map<string, { repo: RepoInfo | null; at: number }>();
const REPO_TTL_MS = 30_000;

/** The git repository containing `cwd`, or null; cached briefly. */
export async function repoFor(cwd: string): Promise<RepoInfo | null> {
  const hit = repoCache.get(cwd);
  if (hit && Date.now() - hit.at < REPO_TTL_MS) return hit.repo;
  const repo = await invoke<RepoInfo | null>("git_resolve_repo", {
    cwd,
    workspace: currentWorkspaceEnv(),
  }).catch(() => null);
  repoCache.set(cwd, { repo, at: Date.now() });
  return repo;
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/u, "").split("/");
  return parts[parts.length - 1] || path;
}

/** What the `@` popup can offer beyond files, for the pane `leafId` in `cwd`. */
export async function specialSources(
  leafId: number,
  cwd: string | null,
  currentSession: string | null,
): Promise<SpecialSources> {
  const panes = liveLeafIds()
    .filter((id) => id !== leafId)
    .map((id) => {
      const dir = leafCwd(id);
      return {
        leafId: id,
        label: dir ? basename(dir) : `pane ${id}`,
        detail: dir ?? "Terminal pane",
      };
    });
  const [repo, chats] = cwd
    ? await Promise.all([
        repoFor(cwd),
        listPastChats(cwd, 12).catch(() => [] as PastChat[]),
      ])
    : [null, [] as PastChat[]];
  return {
    git: repo !== null,
    panes,
    chats: chats
      .filter((c) => c.sessionId !== currentSession)
      .map((c) => ({
        sessionId: c.sessionId,
        title: c.title ?? c.firstPrompt ?? "Untitled chat",
        detail: `${new Date(c.modifiedMs).toLocaleString()}${
          c.title && c.firstPrompt ? ` · ${c.firstPrompt}` : ""
        }`,
      })),
  };
}

function saveContext(text: string): Promise<string> {
  return invoke<string>("agent_save_context", { text });
}

/**
 * Builds and saves the attachment for a context mention; null when there was
 * nothing to attach (a clean working tree, an empty pane).
 */
export async function gatherContext(
  mention: Mention,
  cwd: string | null,
): Promise<SavedContext | null> {
  let text: string | null = null;
  if (mention.kind === "git-working" || mention.kind === "git-branch") {
    if (!cwd) throw new Error("This session has no folder.");
    const repo = await repoFor(cwd);
    if (!repo) throw new Error("This folder isn't a git repository.");
    const result = await invoke<{ diffText: string; truncated: boolean }>(
      "git_context_diff",
      {
        repoRoot: repo.repoRoot,
        kind: mention.kind === "git-working" ? "working" : "branch",
        workspace: currentWorkspaceEnv(),
      },
    );
    text = buildDiffContext(mention.kind, result.diffText, result.truncated);
  } else if (mention.kind === "terminal") {
    const leaf = Number(mention.ref);
    const raw = leafTailText(leaf, CONTEXT_CAPS.terminalLines + 50);
    if (raw === null) throw new Error("That pane is closed.");
    text = buildTerminalContext(
      mention.label.replace(/^terminal:\s*/u, ""),
      raw,
    );
  } else if (mention.kind === "chat") {
    await openTranscript(mention.ref);
    const page = await readTranscript(mention.ref);
    const doc = buildDocument(page.entries);
    text = buildChatContext(
      doc.title ?? mention.label.replace(/^chat:\s*/u, ""),
      doc.turns,
    );
  } else {
    return null;
  }
  if (!text) return null;
  const path = await saveContext(text);
  return { label: mention.label, path };
}
