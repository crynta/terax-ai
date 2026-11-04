/**
 * Composer mentions: files and folders become `@path` tokens Claude Code reads
 * itself; git diffs, another pane's output and past chats are written to a
 * cache file the prompt points at, so the prompt stays short. Pure: the
 * composer owns the pill list and the async gathering.
 */

import type { ReaderTurn } from "./transcript";

export type MentionKind =
  | "file"
  | "folder"
  | "git-working"
  | "git-branch"
  | "terminal"
  | "chat";

export type Mention = {
  kind: MentionKind;
  /** Shown on the pill. */
  label: string;
  /** file/folder: path relative to the session folder; terminal: leaf id; chat: session id; git: "". */
  ref: string;
};

/** A context attachment already written to disk. */
export type SavedContext = { label: string; path: string };

/** Mentions that attach a cache file rather than an `@path`. */
export const CONTEXT_KINDS: ReadonlySet<MentionKind> = new Set([
  "git-working",
  "git-branch",
  "terminal",
  "chat",
]);

export const CONTEXT_CAPS = {
  /** Bytes of diff kept (the backend stops git a little past this). */
  diffBytes: 60 * 1024,
  /** Lines of another pane's output. */
  terminalLines: 200,
  /** Characters of a past chat's summary. */
  chatChars: 24_000,
  /** Characters kept per answer in a past chat's summary. */
  chatAnswerChars: 1_200,
} as const;

export function mentionKey(m: Pick<Mention, "kind" | "ref">): string {
  return `${m.kind}:${m.ref}`;
}

/** `list` with `m` added at the end, unless the same mention is already there. */
export function addMention(list: readonly Mention[], m: Mention): Mention[] {
  const key = mentionKey(m);
  return list.some((x) => mentionKey(x) === key) ? [...list] : [...list, m];
}

export function removeMention(
  list: readonly Mention[],
  key: string,
): Mention[] {
  return list.filter((m) => mentionKey(m) !== key);
}

/** The `@path` token for a file or folder mention. */
export function mentionToken(m: Mention): string | null {
  if (m.kind === "file") return `@${m.ref}`;
  if (m.kind === "folder")
    return `@${m.ref.endsWith("/") ? m.ref : `${m.ref}/`}`;
  return null;
}

/**
 * The prompt actually typed into Claude: the text, then the file and folder
 * tokens (after the text, so a leading `/command` stays first), then one line
 * per context file.
 */
export function serializePrompt(
  text: string,
  mentions: readonly Mention[],
  contexts: readonly SavedContext[] = [],
): string {
  const tokens = mentions.flatMap((m) => {
    const token = mentionToken(m);
    return token ? [token] : [];
  });
  const head = [text.trim(), tokens.join(" ")].filter(Boolean).join(" ");
  const notes = contexts.map((c) => `Context (${c.label}): see ${c.path}`);
  return [head, notes.join("\n")].filter(Boolean).join("\n\n");
}

/** `text` cut to at most `maxBytes` of UTF-8 on a character boundary. */
export function capUtf8(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  // Back off continuation bytes (10xxxxxx) so no character is split.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return {
    text: new TextDecoder().decode(bytes.subarray(0, end)),
    truncated: true,
  };
}

const DIFF_TITLES: Record<"git-working" | "git-branch", string> = {
  "git-working": "Working tree changes (git diff HEAD)",
  "git-branch": "This branch's changes against the default branch",
};

/** A diff attachment, or null when there is nothing to attach. */
export function buildDiffContext(
  kind: "git-working" | "git-branch",
  diff: string,
  truncatedByGit = false,
): string | null {
  if (!diff.trim()) return null;
  const capped = capUtf8(diff, CONTEXT_CAPS.diffBytes);
  const truncated = capped.truncated || truncatedByGit;
  return [
    `# ${DIFF_TITLES[kind]}`,
    "",
    "```diff",
    capped.text.replace(/\s+$/u, ""),
    "```",
    truncated
      ? "\n(Truncated: the diff is larger than this attachment. Run git diff for the rest.)"
      : "",
  ]
    .join("\n")
    .trimEnd();
}

/** The last lines of another pane's output, or null when it printed nothing. */
export function buildTerminalContext(
  label: string,
  text: string,
  maxLines: number = CONTEXT_CAPS.terminalLines,
): string | null {
  const lines = text
    .replace(/\r/gu, "")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (lines.length === 0) return null;
  const kept = lines.slice(-maxLines);
  return [
    `# Terminal output: ${label} (last ${kept.length} lines)`,
    "",
    "```",
    ...kept,
    "```",
  ].join("\n");
}

function answerOf(turn: ReaderTurn): string {
  return turn.blocks
    .flatMap((b) => (b.kind === "text" ? [b.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} …`;
}

/**
 * A compact summary of a past chat: each prompt with the start of its answer,
 * keeping the most recent turns when the whole chat doesn't fit.
 */
export function buildChatContext(
  title: string,
  turns: readonly ReaderTurn[],
  maxChars: number = CONTEXT_CAPS.chatChars,
): string | null {
  const sections: string[] = [];
  for (const turn of turns) {
    const prompt = (turn.command ?? turn.prompt ?? "").trim();
    const answer = answerOf(turn);
    if (!prompt && !answer) continue;
    const parts: string[] = [];
    if (prompt) parts.push(`## You\n\n${clip(prompt, 800)}`);
    if (answer)
      parts.push(`## Claude\n\n${clip(answer, CONTEXT_CAPS.chatAnswerChars)}`);
    sections.push(parts.join("\n\n"));
  }
  if (sections.length === 0) return null;
  const header = `# Past chat: ${title}`;
  const kept: string[] = [];
  let size = header.length;
  for (let i = sections.length - 1; i >= 0; i--) {
    const next = size + sections[i].length + 2;
    if (next > maxChars && kept.length > 0) break;
    kept.unshift(sections[i]);
    size = next;
  }
  const omitted = sections.length - kept.length;
  return [
    header,
    omitted > 0 ? `(${omitted} earlier turns omitted)` : null,
    ...kept,
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");
}

export type SpecialMention = Mention & { detail: string };

export type SpecialSources = {
  /** Other live panes: leaf id and a label (usually the folder). */
  panes: readonly { leafId: number; label: string; detail: string }[];
  /** Past chats in this folder, newest first. */
  chats: readonly { sessionId: string; title: string; detail: string }[];
  /** Whether the session folder is a git repository. */
  git: boolean;
};

const KEYWORD: Record<MentionKind, string> = {
  file: "",
  folder: "",
  "git-working": "git",
  "git-branch": "git",
  terminal: "terminal",
  chat: "chat",
};

/**
 * Whether `query` asks for `m`: an empty query or a prefix of its keyword
 * ("g", "ter") lists them all; the keyword followed by more text ("chat stor")
 * narrows by label. A plain file query ("src/a") never matches.
 */
function wants(query: string, m: SpecialMention): boolean {
  const q = query.toLowerCase();
  const keyword = KEYWORD[m.kind];
  if (!q || keyword.startsWith(q)) return true;
  if (!q.startsWith(keyword)) return false;
  const rest = q.slice(keyword.length).replace(/^[:\s-]+/u, "");
  const hay =
    `${m.label.slice(m.label.indexOf(":") + 1)} ${m.detail}`.toLowerCase();
  return rest.split(/\s+/u).every((word) => hay.includes(word));
}

/**
 * The context mentions offered in the `@` popup for `query`, matched by
 * keyword ("git", "terminal", "chat") and then label, at most `limit`.
 */
export function specialMentions(
  query: string,
  sources: SpecialSources,
  limit = 8,
): SpecialMention[] {
  const all: SpecialMention[] = [];
  if (sources.git) {
    all.push(
      {
        kind: "git-working",
        label: "git: working diff",
        ref: "",
        detail: "Uncommitted changes against HEAD",
      },
      {
        kind: "git-branch",
        label: "git: branch vs main",
        ref: "",
        detail: "Everything this branch changed",
      },
    );
  }
  for (const pane of sources.panes) {
    all.push({
      kind: "terminal",
      label: `terminal: ${pane.label}`,
      ref: String(pane.leafId),
      detail: pane.detail,
    });
  }
  for (const chat of sources.chats) {
    all.push({
      kind: "chat",
      label: `chat: ${chat.title}`,
      ref: chat.sessionId,
      detail: chat.detail,
    });
  }
  return all.filter((m) => wants(query, m)).slice(0, limit);
}
