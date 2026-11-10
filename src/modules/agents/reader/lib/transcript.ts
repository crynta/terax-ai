/**
 * Pure model for the Session Reader: turns the compact transcript entries the
 * Rust side projects from a Claude Code `.jsonl` into a turn-by-turn document
 * (prompt, assistant text, thinking, tool calls paired with their results,
 * edit diffs, subagent work nested under its Task call).
 */

// ---- Wire types (mirror src-tauri/src/modules/agent_transcript.rs) --------

export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolUse"; id: string; name: string; input: unknown }
  | { type: "toolResult"; toolUseId: string; content: string; isError: boolean }
  | { type: "image"; index?: number };

export type TranscriptToolUseResult = {
  filePath?: string;
  oldString?: string;
  newString?: string;
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
};

export type TranscriptEntry = {
  kind: "user" | "assistant" | "system" | "title";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  blocks?: TranscriptBlock[];
  toolUseResult?: TranscriptToolUseResult;
  thinkingDurationMs?: number;
  subtype?: string;
  text?: string;
  /** Byte offset of the entry's line; set when it carries images. */
  lineOffset?: number;
  /** The model behind an assistant message, e.g. "claude-opus-5-5". */
  model?: string;
  /** Token counts of an assistant message. */
  usage?: TranscriptUsage;
};

export type TranscriptUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type TranscriptPage = {
  entries: TranscriptEntry[];
  startOffset: number;
  nextOffset: number;
  size: number;
  reset: boolean;
};

// ---- Reader model -----------------------------------------------------------

export type DiffLine = { kind: "context" | "add" | "remove"; text: string };

/** Where a pasted image's pixels live: its line and ordinal among the line's images. */
export type ImageRef = { offset: number; index: number };

export type ToolCallStatus = "running" | "done" | "error";

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  /** The tool result's text, capped by the backend. */
  result: string | null;
  /** File the call touched (Read/Edit/Write/...), when known. */
  filePath: string | null;
  /** Line diff for Edit/MultiEdit/Write results. */
  diff: DiffLine[] | null;
  stdout: string | null;
  stderr: string | null;
  interrupted: boolean;
  /** Subagent (sidechain) work done under a Task/Agent call. */
  children: ReaderBlock[];
  timestamp: string | null;
};

export type ReaderBlock =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; durationMs: number | null }
  | { kind: "tool"; id: string; call: ToolCall }
  | { kind: "image"; id: string; ref: ImageRef | null }
  | { kind: "notice"; id: string; text: string };

export type ReaderTurn = {
  id: string;
  /** The user's prompt; null for a turn whose prompt is before the loaded window. */
  prompt: string | null;
  /**
   * Text the user pasted into the prompt (Claude Code wraps each paste in
   * `<pasted_content>`), each found verbatim in `prompt`.
   */
  pastes?: string[];
  /** A slash command, or a `!` shell command, shown instead of the raw prompt markup. */
  command: string | null;
  promptAt: string | null;
  /** Images pasted with the prompt. */
  images: ImageRef[];
  blocks: ReaderBlock[];
};

export type ReaderDocument = {
  title: string | null;
  turns: ReaderTurn[];
};

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const COMMAND_STDOUT =
  /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu;

/** A slash command's output without the terminal colours Claude wraps it in. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

const TASK_NOTIFICATION = /^<task-notification>([\s\S]*?)<\/task-notification>/;
const TASK_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;
const TASK_STATUS = /<status>([\s\S]*?)<\/status>/;

/**
 * A background task's completion notice (Claude injects it as a user message),
 * as one readable line, or null when `raw` isn't one.
 */
export function taskNotice(raw: string): string | null {
  const m = TASK_NOTIFICATION.exec(raw.trim());
  if (!m) return null;
  const summary = TASK_SUMMARY.exec(m[1])?.[1].trim();
  const status = TASK_STATUS.exec(m[1])?.[1].trim();
  return summary || `Background task ${status ?? "finished"}`;
}

const BASH_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>$/;
const BASH_OUTPUT = /<bash-(stdout|stderr)>([\s\S]*?)<\/bash-\1>/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

/**
 * The output of a `!` shell command run in Claude (`<bash-stdout>` and
 * `<bash-stderr>`, HTML-escaped by Claude), or null when `raw` isn't one.
 */
export function shellOutput(raw: string): string | null {
  if (!raw.startsWith("<bash-stdout>") && !raw.startsWith("<bash-stderr>")) {
    return null;
  }
  const parts: string[] = [];
  for (const m of raw.matchAll(BASH_OUTPUT)) {
    const text = stripAnsi(m[2])
      .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e)
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

const PASTE_OPEN = /<pasted_content\b[^>]*>/;
const PASTE_CLOSE = /<\/pasted_content\b[^>]*>/;
const PASTE_TAG = /<\/?pasted_content\b[^>]*>/g;

/**
 * A prompt without the `<pasted_content id="…">…</pasted_content id="…">`
 * wrappers Claude Code puts around pasted text, and the pasted texts. A paste
 * whose closing tag was cut off (a long prompt is capped) runs to the end.
 */
export function pastedSpans(raw: string): { text: string; pastes: string[] } {
  const pastes: string[] = [];
  let text = "";
  let rest = raw;
  for (;;) {
    const open = PASTE_OPEN.exec(rest);
    if (!open) break;
    text += rest.slice(0, open.index);
    rest = rest.slice(open.index + open[0].length);
    const close = PASTE_CLOSE.exec(rest);
    const body = (close ? rest.slice(0, close.index) : rest)
      .replace(/^[ \t]*\n/, "")
      .replace(/\n[ \t]*$/, "");
    pastes.push(body);
    // Its own paragraph, so it never runs into the text around it.
    text += `\n\n${body}\n\n`;
    rest = close ? rest.slice(close.index + close[0].length) : "";
  }
  text += rest;
  return { text: text.replace(PASTE_TAG, ""), pastes };
}

/** Groups transcript entries (oldest first) into turns. */
export function buildDocument(
  entries: readonly TranscriptEntry[],
): ReaderDocument {
  let title: string | null = null;
  const turns: ReaderTurn[] = [];
  const calls = new Map<string, ToolCall>();
  let current: ReaderTurn | null = null;
  // The newest Task/Agent call still running: sidechain work nests under it.
  let activeSubagent: ToolCall | null = null;
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${seq++}`;

  const turn = (): ReaderTurn => {
    if (!current) {
      current = {
        id: nextId("t"),
        prompt: null,
        command: null,
        promptAt: null,
        images: [],
        blocks: [],
      };
      turns.push(current);
    }
    return current;
  };

  const push = (block: ReaderBlock, sidechain: boolean) => {
    if (sidechain && activeSubagent) activeSubagent.children.push(block);
    else turn().blocks.push(block);
  };

  for (const entry of entries) {
    if (entry.kind === "title") {
      if (entry.text) title = entry.text;
      continue;
    }
    if (entry.kind === "system") continue;
    const sidechain = entry.isSidechain === true;
    const blocks = entry.blocks ?? [];

    if (entry.kind === "user") {
      let resultId: string | null = null;
      for (const block of blocks) {
        if (block.type !== "toolResult") continue;
        const call = calls.get(block.toolUseId);
        if (!call) continue;
        call.status = block.isError ? "error" : "done";
        call.result = block.content;
        resultId ??= block.toolUseId;
        if (call === activeSubagent) activeSubagent = null;
      }
      if (resultId && entry.toolUseResult) {
        applyToolUseResult(
          calls.get(resultId) as ToolCall,
          entry.toolUseResult,
        );
      }
      if (entry.isMeta || sidechain) continue;
      const joined = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const raw = joined.trim();
      const images = imageRefs(entry);
      // Untrimmed, so a pasted diagram keeps its first line's indent.
      const pasted = pastedSpans(joined);
      const text = stripImagePlaceholders(pasted.text);
      const pastes = pasted.pastes
        .map(stripImagePlaceholders)
        .filter((p) => p && text.includes(p));
      if (!text && images.length === 0) continue;
      const stdout = COMMAND_STDOUT.exec(raw);
      if (stdout) {
        const output = stripAnsi(stdout[1]).trim();
        if (output)
          turn().blocks.push({ kind: "notice", id: nextId("n"), text: output });
        continue;
      }
      if (raw.startsWith("<local-command-caveat>")) continue;
      // A background task finishing: Claude answers it like a prompt.
      const task = taskNotice(raw);
      if (task !== null) {
        current = {
          id: entry.uuid ?? nextId("t"),
          prompt: null,
          command: null,
          promptAt: entry.timestamp ?? null,
          images: [],
          blocks: [{ kind: "notice", id: nextId("n"), text: task }],
        };
        turns.push(current);
        continue;
      }
      // `! command` in Claude: the command opens a turn, its output follows.
      const shell = shellOutput(raw);
      if (shell !== null) {
        if (shell)
          turn().blocks.push({ kind: "notice", id: nextId("n"), text: shell });
        continue;
      }
      const bash = BASH_INPUT.exec(raw);
      if (bash) {
        current = {
          id: entry.uuid ?? nextId("t"),
          prompt: null,
          command: `!${bash[1].trim()}`,
          promptAt: entry.timestamp ?? null,
          images,
          blocks: [],
        };
        turns.push(current);
        continue;
      }
      const name = COMMAND_NAME.exec(raw);
      current = {
        id: entry.uuid ?? nextId("t"),
        prompt: name
          ? (COMMAND_ARGS.exec(raw)?.[1].trim() ?? "") || null
          : text || null,
        pastes: name ? [] : pastes,
        command: name ? name[1].trim() : null,
        promptAt: entry.timestamp ?? null,
        images,
        blocks: [],
      };
      turns.push(current);
      continue;
    }

    // assistant
    for (const block of blocks) {
      switch (block.type) {
        case "text":
          if (block.text.trim()) {
            push(
              { kind: "text", id: nextId("x"), text: block.text },
              sidechain,
            );
          }
          break;
        case "thinking":
          push(
            {
              kind: "thinking",
              id: nextId("k"),
              text: block.text,
              durationMs: entry.thinkingDurationMs ?? null,
            },
            sidechain,
          );
          break;
        case "toolUse": {
          const call: ToolCall = {
            id: block.id,
            name: block.name,
            input: block.input,
            status: "running",
            result: null,
            filePath: inputFilePath(block.input),
            diff: null,
            stdout: null,
            stderr: null,
            interrupted: false,
            children: [],
            timestamp: entry.timestamp ?? null,
          };
          calls.set(block.id, call);
          push({ kind: "tool", id: block.id, call }, sidechain);
          if (!sidechain && SUBAGENT_TOOLS.has(block.name))
            activeSubagent = call;
          break;
        }
        case "image":
          push(
            {
              kind: "image",
              id: nextId("i"),
              ref:
                entry.lineOffset === undefined
                  ? null
                  : { offset: entry.lineOffset, index: block.index ?? 0 },
            },
            sidechain,
          );
          break;
        default:
          break;
      }
    }
  }
  return { title, turns };
}

function imageRefs(entry: TranscriptEntry): ImageRef[] {
  const offset = entry.lineOffset;
  if (offset === undefined) return [];
  const refs: ImageRef[] = [];
  for (const block of entry.blocks ?? []) {
    if (block.type === "image") refs.push({ offset, index: block.index ?? 0 });
  }
  return refs;
}

/** A run of `[Image #N]` tokens with the spaces around them. */
const IMAGE_TOKENS = /[ \t]*(?:\[Image #\d+\][ \t]*)+/g;
const IMAGE_SOURCE_LINE = /^\s*\[Image: source: [^\]\n]*\]\s*$/gm;

/**
 * A prompt without Claude Code's image markers: the inline `[Image #N]`
 * tokens and the `[Image: source: …]` lines it adds for pasted files.
 */
export function stripImagePlaceholders(text: string): string {
  return (
    text
      .replace(IMAGE_SOURCE_LINE, "")
      // Only the gap a token leaves closes up: other runs of spaces are the
      // user's own alignment (a pasted table or diagram).
      .replace(IMAGE_TOKENS, (token, offset: number, all: string) => {
        const lineStart = offset === 0 || all[offset - 1] === "\n";
        const end = offset + token.length;
        const lineEnd = end === all.length || all[end] === "\n";
        return lineStart || lineEnd ? "" : " ";
      })
      .replace(/\n{3,}/g, "\n\n")
      // Blank lines go; the first line's indent stays.
      .replace(/^(?:[ \t]*\n)+/, "")
      .trimEnd()
  );
}

function applyToolUseResult(
  call: ToolCall,
  result: TranscriptToolUseResult,
): void {
  if (result.filePath) call.filePath = result.filePath;
  if (result.stdout) call.stdout = result.stdout;
  if (result.stderr) call.stderr = result.stderr;
  if (result.interrupted) call.interrupted = true;
  if (result.oldString !== undefined || result.newString !== undefined) {
    call.diff = lineDiff(result.oldString ?? "", result.newString ?? "");
  } else if (call.name === "Write") {
    const content = (call.input as { content?: unknown } | null)?.content;
    if (typeof content === "string") call.diff = lineDiff("", content);
  }
}

function inputFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "notebook_path", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** Above this many line pairs the LCS table is skipped for a plain swap. */
const DIFF_CELL_LIMIT = 4_000_000;

/**
 * A line diff of `before` → `after` via longest common subsequence, with the
 * shared head and tail trimmed first so typical edits stay tiny.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const out: DiffLine[] = a
    .slice(0, head)
    .map((text) => ({ kind: "context", text }));
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  if (midA.length * midB.length > DIFF_CELL_LIMIT) {
    for (const text of midA) out.push({ kind: "remove", text });
    for (const text of midB) out.push({ kind: "add", text });
  } else {
    const n = midA.length;
    const m = midB.length;
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ kind: "context", text: midA[i] });
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        out.push({ kind: "remove", text: midA[i++] });
      } else {
        out.push({ kind: "add", text: midB[j++] });
      }
    }
    while (i < n) out.push({ kind: "remove", text: midA[i++] });
    while (j < m) out.push({ kind: "add", text: midB[j++] });
  }
  for (const text of a.slice(a.length - tail))
    out.push({ kind: "context", text });
  return out;
}

// ---- Bounded entry buffer ---------------------------------------------------

export const MAX_ENTRIES = 2000;
export const MAX_BYTES = 8 * 1024 * 1024;

/** Rough in-memory size of an entry: the length of every string it carries. */
export function entrySize(entry: TranscriptEntry): number {
  let size = 64 + (entry.text?.length ?? 0);
  for (const block of entry.blocks ?? []) {
    switch (block.type) {
      case "text":
      case "thinking":
        size += block.text.length;
        break;
      case "toolUse":
        size += block.name.length + JSON.stringify(block.input ?? null).length;
        break;
      case "toolResult":
        size += block.content.length;
        break;
      default:
        break;
    }
  }
  const tur = entry.toolUseResult;
  if (tur) {
    size +=
      (tur.oldString?.length ?? 0) +
      (tur.newString?.length ?? 0) +
      (tur.stdout?.length ?? 0) +
      (tur.stderr?.length ?? 0);
  }
  return size;
}

/**
 * The loaded slice of one transcript, capped at {@link MAX_ENTRIES} entries and
 * {@link MAX_BYTES}: appending past either drops the oldest entries, and
 * `truncated` then tells the Reader that earlier turns are not shown.
 */
export class TranscriptBuffer {
  entries: TranscriptEntry[] = [];
  /** Offset of the earliest loaded line, for paging backwards. */
  startOffset = 0;
  /** Offset to continue reading from. */
  nextOffset: number | null = null;
  truncated = false;
  private bytes = 0;

  constructor(
    private readonly maxEntries = MAX_ENTRIES,
    private readonly maxBytes = MAX_BYTES,
  ) {}

  /** Applies a forward or tail page. Returns whether anything changed. */
  append(page: TranscriptPage): boolean {
    if (page.reset) this.clear();
    const first = this.nextOffset === null;
    if (first || page.reset) this.startOffset = page.startOffset;
    const moved = this.nextOffset !== page.nextOffset;
    this.nextOffset = page.nextOffset;
    if (page.entries.length === 0) return moved || page.reset;
    for (const entry of page.entries) {
      this.entries.push(entry);
      this.bytes += entrySize(entry);
    }
    this.trimOldest();
    return true;
  }

  /** Applies a backward ("Load earlier") page in front of what is loaded. */
  prepend(page: TranscriptPage): boolean {
    this.startOffset = page.startOffset;
    if (page.entries.length === 0) return false;
    let added = 0;
    const room = this.maxEntries - this.entries.length;
    const take = page.entries.slice(Math.max(0, page.entries.length - room));
    for (const entry of take) added += entrySize(entry);
    if (
      take.length < page.entries.length ||
      this.bytes + added > this.maxBytes
    ) {
      this.truncated = true;
    }
    this.entries = [...take, ...this.entries];
    this.bytes += added;
    return take.length > 0;
  }

  get canLoadEarlier(): boolean {
    return this.startOffset > 0 && this.entries.length < this.maxEntries;
  }

  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.startOffset = 0;
    this.nextOffset = null;
    this.truncated = false;
  }

  private trimOldest(): void {
    let drop = 0;
    while (
      drop < this.entries.length - 1 &&
      (this.entries.length - drop > this.maxEntries ||
        this.bytes > this.maxBytes)
    ) {
      this.bytes -= entrySize(this.entries[drop]);
      drop++;
    }
    if (drop > 0) {
      this.entries = this.entries.slice(drop);
      this.truncated = true;
    }
  }
}
