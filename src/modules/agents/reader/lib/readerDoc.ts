/**
 * Pure helpers for Reader v2: merged thinking, the full-view outline and
 * session stats, in-document search, view filters, prompt payloads for the
 * composer, and per-turn Markdown for copying.
 */
import { toolKind } from "./readerView";
import type { ReaderBlock, ReaderTurn, ToolCall } from "./transcript";

/**
 * Consecutive thinking blocks folded into one: durations summed, texts joined.
 * A thought with neither text nor a duration is dropped.
 */
export function mergeThinking(blocks: readonly ReaderBlock[]): ReaderBlock[] {
  const out: ReaderBlock[] = [];
  let run: Extract<ReaderBlock, { kind: "thinking" }> | null = null;
  for (const block of blocks) {
    if (block.kind !== "thinking") {
      run = null;
      out.push(block);
      continue;
    }
    const text = block.text.trim();
    const duration = block.durationMs ?? 0;
    if (!text && duration <= 0) continue;
    if (run) {
      run.text = [run.text, text].filter(Boolean).join("\n\n");
      run.durationMs = (run.durationMs ?? 0) + duration || null;
      continue;
    }
    run = { ...block, text, durationMs: duration || null };
    out.push(run);
  }
  return out;
}

export type ReaderFilters = { tools: boolean; thinking: boolean };

export const ALL_FILTERS: ReaderFilters = { tools: true, thinking: true };

/** Blocks hidden by the full view's "Show tools" / "Show thinking" toggles. */
export function filterBlocks(
  blocks: readonly ReaderBlock[],
  filters: ReaderFilters,
): readonly ReaderBlock[] {
  if (filters.tools && filters.thinking) return blocks;
  return blocks.filter(
    (b) =>
      (filters.tools || b.kind !== "tool") &&
      (filters.thinking || b.kind !== "thinking"),
  );
}

/** Tool calls of a turn, subagent work included. */
export function turnCalls(turn: ReaderTurn): ToolCall[] {
  const calls: ToolCall[] = [];
  const visit = (blocks: readonly ReaderBlock[]) => {
    for (const block of blocks) {
      if (block.kind !== "tool") continue;
      calls.push(block.call);
      visit(block.call.children);
    }
  };
  visit(turn.blocks);
  return calls;
}

const SUMMARY_MAX = 80;

/** One line naming a turn in the outline: its prompt, command, or a fallback. */
export function turnSummary(turn: ReaderTurn): string {
  const source = turn.prompt?.trim() || "";
  const line = source.split("\n").find((l) => l.trim()) ?? "";
  const command = turn.command
    ? turn.command.startsWith("/")
      ? turn.command
      : `/${turn.command}`
    : "";
  const text = [command, line.trim()].filter(Boolean).join(" ");
  if (!text) return turn.images.length > 0 ? "Image" : "Earlier work";
  return text.length > SUMMARY_MAX
    ? `${text.slice(0, SUMMARY_MAX - 1).trimEnd()}…`
    : text;
}

export type OutlineItem = {
  id: string;
  summary: string;
  at: string | null;
  tools: number;
  edits: number;
  images: number;
};

const EDIT_KINDS = new Set(["edit", "write"]);

export function buildOutline(turns: readonly ReaderTurn[]): OutlineItem[] {
  return turns.map((turn) => {
    const calls = turnCalls(turn);
    return {
      id: turn.id,
      summary: turnSummary(turn),
      at: turn.promptAt,
      tools: calls.length,
      edits: calls.filter((c) => EDIT_KINDS.has(toolKind(c.name))).length,
      images: turn.images.length,
    };
  });
}

export type SessionStats = {
  turns: number;
  toolCalls: number;
  errors: number;
  /** Files edited or written, in first-touched order. */
  files: string[];
};

export function sessionStats(turns: readonly ReaderTurn[]): SessionStats {
  let toolCalls = 0;
  let errors = 0;
  const files = new Set<string>();
  for (const turn of turns) {
    for (const call of turnCalls(turn)) {
      toolCalls += 1;
      if (call.status === "error") errors += 1;
      if (call.filePath && EDIT_KINDS.has(toolKind(call.name)))
        files.add(call.filePath);
    }
  }
  return { turns: turns.length, toolCalls, errors, files: [...files] };
}

/** Start offsets of every case-insensitive, non-overlapping `query` in `text`. */
export function findMatches(text: string, query: string): number[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [];
  const hay = text.toLocaleLowerCase();
  const out: number[] = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

/**
 * The bytes the composer types for `text` before the separate submit "\r".
 * Under bracketed paste a multi-line prompt arrives as one paste, so its
 * newlines do not submit early; without it newlines become spaces.
 */
export function promptPayload(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\x1b/g, "␛");
  if (!normalized.includes("\n")) return normalized;
  return bracketed
    ? `\x1b[200~${normalized}\x1b[201~`
    : normalized.replace(/\s*\n\s*/g, " ");
}

/**
 * Everything the composer types before the submit "\r", in order. Each image
 * path goes in as its own paste, the way a dropped file arrives, so Claude
 * Code turns it into an attachment; the text follows.
 */
export function promptWrites(
  text: string,
  imagePaths: readonly string[],
  bracketed: boolean,
): string[] {
  const writes = imagePaths.map((path) => {
    const clean = path.replace(/[\x00-\x1f\x7f]/g, "");
    return bracketed ? `\x1b[200~${clean}\x1b[201~` : `${clean} `;
  });
  const body = text.trim();
  if (body) {
    writes.push(
      promptPayload(writes.length > 0 ? ` ${body}` : body, bracketed),
    );
  }
  return writes;
}

/** A turn as Markdown: the prompt, Claude's text, and one line per tool call. */
export function turnMarkdown(turn: ReaderTurn): string {
  const parts: string[] = [];
  const prompt = [turn.command, turn.prompt].filter(Boolean).join(" ");
  if (prompt) parts.push(`**You:** ${prompt}`);
  const visit = (blocks: readonly ReaderBlock[], depth: number) => {
    for (const block of blocks) {
      if (block.kind === "text") parts.push(block.text.trim());
      else if (block.kind === "tool") {
        const target = block.call.filePath ?? commandOf(block.call);
        parts.push(
          `${"  ".repeat(depth)}- \`${block.call.name}\`${target ? ` ${target}` : ""}`,
        );
        visit(block.call.children, depth + 1);
      }
    }
  };
  visit(turn.blocks, 0);
  return parts.join("\n\n");
}

function commandOf(call: ToolCall): string | null {
  const input = call.input as { command?: unknown } | null;
  return typeof input?.command === "string"
    ? `\`${input.command.split("\n")[0]}\``
    : null;
}
