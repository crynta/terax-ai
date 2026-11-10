/**
 * Reads Claude Code's `/rewind` picker off the pane's screen and plans the
 * keys that pick a given earlier prompt, so the Reader can restore a
 * checkpoint, re-run an edited prompt or fork without the terminal.
 *
 * The picker lists earlier prompts with one marked selected (`❯`), under a
 * "Rewind" header; secondary lines (code-change counts) sit indented deeper:
 *
 *   Rewind
 *   Restore the code and/or conversation to the point before…
 *
 *     explain the storage tiers
 *     No code changes
 *   ❯ fix the flaky test
 *     2 files changed +10 -3
 *     (current)
 *
 * After Enter, a numbered menu asks what to restore; that one is parsed by
 * `parseClaudeDialog` and matched with `restoreOptionFor`.
 */
import { type ClaudeDialog, cleanScreenLine, dialogKeys } from "./claudeDialog";

export type RewindItem = {
  text: string;
  selected: boolean;
  /** The "(current)" row: the conversation as it is now. */
  current: boolean;
};

export type RewindPicker = {
  items: RewindItem[];
  selectedIndex: number;
  /** Items run newest first (the current row is at the top). */
  newestFirst: boolean;
};

export type RestoreChoice = "both" | "conversation" | "code" | "cancel";

/** Lines scanned above the bottom of the screen. */
const SCAN_LINES = 60;
/** Lines searched above the first item for the picker's header. */
const HEADER_REACH = 14;
const MARKER = /^(\s*)([❯›▸➤>])\s+(\S.*)$/u;
const HEADER = /\brewind\b|restore the code|restore (?:the )?conversation/iu;
const HINT =
  /^(?:enter|esc|↑|↓|tab|space|ctrl|press)\b|\bto (?:select|cancel|confirm|navigate)\b/iu;
const CURRENT = /^\(current\)$/iu;
const RULE = /^[\s─━═]*[─━═]{6,}[\s─━═]*$/u;

const ARROW_DOWN = "\x1b[B";
const ARROW_UP = "\x1b[A";

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The rewind picker on `screen`, or null when none is showing. */
export function parseRewindPicker(screen: string): RewindPicker | null {
  const lines = screen.split("\n").map(cleanScreenLine);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  const from = Math.max(0, end - SCAN_LINES);

  let selectedLine = -1;
  for (let i = end - 1; i >= from; i--) {
    if (MARKER.test(lines[i])) {
      if (selectedLine >= 0) return null; // Two selections: not a single picker.
      selectedLine = i;
    }
  }
  if (selectedLine < 0) return null;
  const marker = MARKER.exec(lines[selectedLine]);
  if (!marker) return null;
  // Numbered options belong to the restore menu, not the prompt list.
  if (/^\d{1,2}[.)]\s/u.test(marker[3])) return null;
  const textCol = lines[selectedLine].indexOf(marker[3]);

  const isItem = (line: string) =>
    !MARKER.test(line) &&
    line.trim() !== "" &&
    indentOf(line) === textCol &&
    !HINT.test(line.trim()) &&
    !RULE.test(line);

  // Walk up and down from the selection, collecting rows at the text column
  // and skipping the deeper secondary lines.
  let top = selectedLine;
  for (let i = selectedLine - 1, blanks = 0; i >= from; i--) {
    const line = lines[i];
    if (!line.trim()) {
      if (++blanks > 1) break;
      continue;
    }
    blanks = 0;
    if (indentOf(line) < textCol || RULE.test(line)) break;
    if (isItem(line) || indentOf(line) > textCol) top = i;
  }
  let bottom = selectedLine;
  for (let i = selectedLine + 1, blanks = 0; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (++blanks > 1) break;
      continue;
    }
    blanks = 0;
    if (indentOf(line) < textCol || RULE.test(line) || HINT.test(line.trim()))
      break;
    bottom = i;
  }

  let header = false;
  for (let i = top - 1; i >= Math.max(from, top - HEADER_REACH); i--) {
    if (HEADER.test(lines[i])) {
      header = true;
      break;
    }
  }
  if (!header) return null;

  const items: RewindItem[] = [];
  let selectedIndex = -1;
  for (let i = top; i <= bottom; i++) {
    const line = lines[i];
    if (i === selectedLine) {
      selectedIndex = items.length;
      items.push({
        text: marker[3].trim(),
        selected: true,
        current: CURRENT.test(marker[3].trim()),
      });
    } else if (isItem(line)) {
      const text = line.trim();
      items.push({ text, selected: false, current: CURRENT.test(text) });
    }
  }
  if (items.length < 1 || selectedIndex < 0) return null;
  const currentAt = items.findIndex((it) => it.current);
  return {
    items,
    selectedIndex,
    newestFirst: currentAt === 0 && items.length > 1,
  };
}

/** Lowercase, single-spaced, without a trailing ellipsis or the leading slash of a command. */
export function matchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/(?:…|\.{3})\s*$/u, "")
    .trim();
}

function sameText(itemText: string, prompt: string): boolean {
  const a = matchKey(itemText);
  const b = matchKey(prompt);
  if (!a || !b) return false;
  if (a === b) return true;
  // The picker truncates long prompts: a prefix of at least 8 characters counts.
  if (a.length >= 8 && b.startsWith(a)) return true;
  return b.length >= 8 && a.startsWith(b);
}

/**
 * The picker row for `prompt`, the `occurrence`-th (0-based, oldest first)
 * when the same text was sent more than once; -1 when it isn't visible.
 */
export function rewindTargetIndex(
  picker: RewindPicker,
  prompt: string,
  occurrence = 0,
): number {
  const hits: number[] = [];
  picker.items.forEach((item, index) => {
    if (!item.current && sameText(item.text, prompt)) hits.push(index);
  });
  if (picker.newestFirst) hits.reverse();
  return hits[occurrence] ?? hits[hits.length - 1] ?? -1;
}

export type RewindStep =
  /** The target row is selected: press Enter. */
  | { kind: "enter" }
  /** Move the selection by `keys` arrows towards the visible target. */
  | { kind: "move"; keys: string }
  /** The target is off screen: one arrow towards older prompts. */
  | { kind: "scroll"; keys: string };

/** The next keys to put the selection on `prompt`. */
export function planRewindStep(
  picker: RewindPicker,
  prompt: string,
  occurrence = 0,
): RewindStep {
  const target = rewindTargetIndex(picker, prompt, occurrence);
  if (target === picker.selectedIndex) return { kind: "enter" };
  if (target >= 0) {
    const delta = target - picker.selectedIndex;
    const arrow = delta > 0 ? ARROW_DOWN : ARROW_UP;
    return { kind: "move", keys: arrow.repeat(Math.abs(delta)) };
  }
  // Older prompts are away from the "(current)" row.
  return { kind: "scroll", keys: picker.newestFirst ? ARROW_DOWN : ARROW_UP };
}

const RESTORE_PATTERNS: Record<RestoreChoice, (label: string) => boolean> = {
  both: (l) =>
    /code and (?:the )?conversation|conversation and (?:the )?code|\bboth\b/iu.test(
      l,
    ),
  conversation: (l) => /conversation/iu.test(l) && !/\bcode\b/iu.test(l),
  code: (l) => /\bcode\b/iu.test(l) && !/conversation/iu.test(l),
  cancel: (l) => /never ?mind|cancel|do nothing|go back/iu.test(l),
};

/** Whether `dialog` is Claude's "what to restore" menu. */
export function isRestoreMenu(dialog: ClaudeDialog): boolean {
  const labels = dialog.options.map((o) => o.label);
  return (
    labels.some((l) => /restore|conversation|\bcode\b/iu.test(l)) &&
    labels.some(
      (l) => RESTORE_PATTERNS.conversation(l) || RESTORE_PATTERNS.both(l),
    )
  );
}

/** The option number for `choice` in the restore menu, or null. */
export function restoreOptionFor(
  dialog: ClaudeDialog,
  choice: RestoreChoice,
): number | null {
  const match = dialog.options.find((o) => RESTORE_PATTERNS[choice](o.label));
  if (match) return match.n;
  if (choice === "cancel")
    return dialog.options.find((o) => o.escape)?.n ?? null;
  return null;
}

/** Keys that pick `choice` in the restore menu, or null when it isn't offered. */
export function restoreKeys(
  dialog: ClaudeDialog,
  choice: RestoreChoice,
): string | null {
  const n = restoreOptionFor(dialog, choice);
  return n === null ? null : dialogKeys(dialog, n);
}

/**
 * The text in Claude Code's input box (between its two rules, after the
 * `❯`/`>` prompt), or null when no input box is on screen.
 */
export function inputBoxText(screen: string): string | null {
  const lines = screen.split("\n").map(cleanScreenLine);
  const PROMPT = /^\s*[❯>]\s?(.*)$/u;
  for (let i = lines.length - 1; i > 0; i--) {
    if (!RULE.test(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(0, i - 14); j--) {
      if (RULE.test(lines[j])) {
        const body = lines.slice(j + 1, i);
        const first = body.findIndex((l) => PROMPT.test(l));
        if (first < 0) break;
        const text = [
          PROMPT.exec(body[first])?.[1] ?? "",
          ...body.slice(first + 1).map((l) => l.trim()),
        ]
          .join("\n")
          .trim();
        return text;
      }
    }
  }
  return null;
}

/** The 0-based occurrence of `turnIndex`'s prompt among earlier turns with the same text. */
export function promptOccurrence(
  prompts: readonly (string | null)[],
  turnIndex: number,
): number {
  const key = matchKey(prompts[turnIndex] ?? "");
  let n = 0;
  for (let i = 0; i < turnIndex; i++) {
    if (matchKey(prompts[i] ?? "") === key) n++;
  }
  return n;
}
