/**
 * Reads a Claude Code permission or choice dialog off the pane's screen text,
 * so the Reader can answer it without switching to the terminal.
 *
 * A dialog is a run of numbered options (`1.`, `2.`, …) near the bottom of the
 * screen with exactly one marked as selected (`❯`), usually under a question
 * and a tool header:
 *
 *   Bash command
 *     git status
 *   Do you want to proceed?
 *   ❯ 1. Yes
 *     2. Yes, and don't ask again for git status commands in /repo
 *     3. No, and tell Claude what to do differently (esc)
 *
 * Box borders (`│ ╭ ╰ ─`) are stripped first. Anything else, like a numbered
 * list in ordinary output, needs the same selected-marker shape to match.
 */

export type DialogKind =
  | "command"
  | "edit"
  | "create"
  | "read"
  | "fetch"
  | "plan"
  | "question"
  | "permission";

export type DialogOption = {
  n: number;
  label: string;
  description: string | null;
  selected: boolean;
  /** The option Esc picks ("… (esc)"). */
  escape: boolean;
};

export type ClaudeDialog = {
  kind: DialogKind;
  header: string | null;
  /** Lines between the header and the question (command text, file, diff…). */
  details: string[];
  question: string | null;
  options: DialogOption[];
  /** Checkbox questions: toggled with Space, so the Reader hands them to the terminal. */
  multiSelect: boolean;
};

/** Lines scanned above the bottom of the screen. */
const SCAN_LINES = 70;
/** Non-empty lines allowed under the last option (hints, footers, borders). */
const FOOTER_MAX = 6;
/** Non-option lines allowed between two options (wrapped labels, descriptions). */
const GAP_MAX = 4;
/** Lines searched above the first option for the question. */
const QUESTION_REACH = 4;
/** Lines searched above the question for the header block. */
const HEADER_REACH = 18;

const SELECT_MARKERS = "❯›▸➤>";
const OPTION_RE = new RegExp(
  `^(\\s*)([${SELECT_MARKERS}])?\\s*(\\d{1,2})[.)]\\s+(\\S.*?)\\s*$`,
  "u",
);
const BORDER_ONLY = /^[\s─━═╌╍┄┅┈┉╭╮╰╯┌┐└┘├┤┬┴┼│┃╷╵╶╴]*$/u;
const RULE = /[─━═╌╍┄┅┈┉]{3,}/u;
const CHECKBOX = /^(\[[ xX✓✔]\]|[☐☑☒])\s*/u;

/** Strips one box border from each side of a line and trailing spaces. */
export function cleanScreenLine(raw: string): string {
  return raw
    .replace(/\s+$/u, "")
    .replace(/^(\s*)[│┃]\s?/u, "$1")
    .replace(/\s*[│┃]$/u, "")
    .replace(/\s+$/u, "");
}

type OptionHit = {
  index: number;
  indent: number;
  n: number;
  label: string;
  selected: boolean;
};

function optionAt(line: string, index: number): OptionHit | null {
  const m = OPTION_RE.exec(line);
  if (!m) return null;
  return {
    index,
    indent: m[1].length,
    n: Number(m[3]),
    label: m[4],
    selected: Boolean(m[2]),
  };
}

const isBlank = (line: string) => line.trim() === "";
const isBorder = (line: string) =>
  !isBlank(line) && (BORDER_ONLY.test(line) || RULE.test(line.trim()));

/** The bottom-most run 1..N of options, each within GAP_MAX lines of the last. */
function lastOptionRun(lines: string[], from: number): OptionHit[] | null {
  let best: OptionHit[] | null = null;
  let run: OptionHit[] = [];
  for (let i = from; i < lines.length; i++) {
    const hit = optionAt(lines[i], i);
    if (!hit) {
      const last = run[run.length - 1];
      if (last && i - last.index > GAP_MAX) {
        if (run.length >= 2) best = run;
        run = [];
      }
      continue;
    }
    const last = run[run.length - 1];
    if (hit.n === 1) {
      if (run.length >= 2) best = run;
      run = [hit];
    } else if (
      last &&
      hit.n === last.n + 1 &&
      hit.index - last.index <= GAP_MAX + 1
    ) {
      run.push(hit);
    } else {
      if (run.length >= 2) best = run;
      run = [];
    }
  }
  if (run.length >= 2) best = run;
  return best;
}

function classify(
  header: string | null,
  question: string | null,
  labels: string[],
): DialogKind {
  const h = (header ?? "").toLowerCase();
  const q = (question ?? "").toLowerCase();
  const all = labels.join(" ").toLowerCase();
  if (/keep planning|auto-accept edits|manually approve edits/u.test(all)) {
    return "plan";
  }
  if (/bash|command/u.test(h)) return "command";
  if (/\bedit\b|make this edit/u.test(h) || /make this edit/u.test(q)) {
    return "edit";
  }
  if (/create|write/u.test(h) || /want to create/u.test(q)) return "create";
  if (/\bread\b/u.test(h) || /want to read/u.test(q)) return "read";
  if (/fetch|web|url/u.test(h)) return "fetch";
  const permission = labels.some((l) => /^(yes|no)\b/iu.test(l));
  return permission ? "permission" : "question";
}

function dedent(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start++;
  while (end > start && isBlank(lines[end - 1])) end--;
  const body = lines.slice(start, end);
  const indents = body
    .filter((l) => !isBlank(l))
    .map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return body.map((l) => l.slice(cut));
}

/** Parses the dialog on `screen`, or null when the bottom of the screen has none. */
export function parseClaudeDialog(screen: string): ClaudeDialog | null {
  const lines = screen.split("\n").map(cleanScreenLine);
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1])) end--;
  const visible = lines.slice(0, end);
  const from = Math.max(0, visible.length - SCAN_LINES);
  const run = lastOptionRun(visible, from);
  if (!run) return null;
  if (run.filter((o) => o.selected).length !== 1) return null;

  const first = run[0];
  const last = run[run.length - 1];
  const optionIndent = first.indent;

  // Descriptions: lines after an option, indented past its number, before the next.
  const descriptions = new Map<number, string>();
  let tail = last.index;
  for (let k = 0; k < run.length; k++) {
    const opt = run[k];
    const stop = k + 1 < run.length ? run[k + 1].index : visible.length;
    const extra: string[] = [];
    for (let i = opt.index + 1; i < stop; i++) {
      const line = visible[i];
      if (isBlank(line) || isBorder(line)) break;
      const indent = line.length - line.trimStart().length;
      if (indent <= optionIndent && k === run.length - 1) break;
      extra.push(line.trim());
      if (k === run.length - 1) tail = i;
    }
    if (extra.length) descriptions.set(opt.n, extra.join(" "));
  }

  // Only short footers (hints, borders) may follow the options.
  let footer = 0;
  for (let i = tail + 1; i < visible.length; i++) {
    if (!isBlank(visible[i]) && !isBorder(visible[i])) footer++;
  }
  if (footer > FOOTER_MAX) return null;

  let questionIndex = -1;
  for (
    let i = first.index - 1;
    i >= Math.max(0, first.index - QUESTION_REACH);
    i--
  ) {
    const line = visible[i];
    if (isBlank(line)) continue;
    if (isBorder(line)) break;
    questionIndex = i;
    break;
  }
  const question = questionIndex >= 0 ? visible[questionIndex].trim() : null;

  let header: string | null = null;
  let details: string[] = [];
  if (questionIndex > 0) {
    let top = questionIndex - 1;
    const floor = Math.max(0, questionIndex - HEADER_REACH);
    while (top >= floor && !isBorder(visible[top])) top--;
    const block = dedent(visible.slice(top + 1, questionIndex));
    const headIndex = block.findIndex((l) => !isBlank(l));
    if (headIndex >= 0) {
      header = block[headIndex].trim();
      details = dedent(block.slice(headIndex + 1));
    }
  }

  const options: DialogOption[] = run.map((o) => {
    const label = o.label.trim();
    return {
      n: o.n,
      label: label.replace(/\s*\((esc|shift\+tab)\)\s*$/iu, ""),
      description: descriptions.get(o.n) ?? null,
      selected: o.selected,
      escape: /\(esc\)\s*$/iu.test(label),
    };
  });
  const multiSelect = options.some((o) => CHECKBOX.test(o.label));
  return {
    kind: classify(
      header,
      question,
      options.map((o) => o.label),
    ),
    header,
    details,
    question,
    options,
    multiSelect,
  };
}

/** Same dialog on screen: unchanged question, options and selection. */
export function sameDialog(
  a: ClaudeDialog | null,
  b: ClaudeDialog | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.question !== b.question || a.header !== b.header) return false;
  if (a.options.length !== b.options.length) return false;
  return a.options.every(
    (o, i) =>
      o.label === b.options[i].label && o.selected === b.options[i].selected,
  );
}

const ARROW_DOWN = "\x1b[B";
const ARROW_UP = "\x1b[A";

/**
 * Keys that pick option `n`: arrows from the selected option, then Enter.
 * Works whatever the select's number-key behaviour.
 */
export function dialogKeys(dialog: ClaudeDialog, n: number): string | null {
  if (!dialog.options.some((o) => o.n === n)) return null;
  const current = dialog.options.find((o) => o.selected)?.n ?? 1;
  const delta = n - current;
  const arrow = delta > 0 ? ARROW_DOWN : ARROW_UP;
  return `${arrow.repeat(Math.abs(delta))}\r`;
}

export const DIALOG_TITLES: Record<DialogKind, string> = {
  command: "Run command",
  edit: "Edit file",
  create: "Create file",
  read: "Read file",
  fetch: "Fetch URL",
  plan: "Plan ready",
  question: "Question",
  permission: "Permission",
};

/** Option styling: the first is the primary answer, a plain "No…" the destructive one. */
export function optionTone(
  option: DialogOption,
): "primary" | "danger" | "neutral" {
  if (option.n === 1) return "primary";
  if (/^no\b/iu.test(option.label) || option.escape) return "danger";
  return "neutral";
}
