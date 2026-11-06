/**
 * Claude Code's interactive panels — `/usage`, `/status`, `/config`, `/mcp`,
 * `/model`, `/agents`, `/hooks`, `/plugin`, `/resume` and the like — replace
 * the prompt box with a full-width view under a `▔▔▔` rule, driven by the
 * keyboard. Read one off the pane's screen so the Reader can show it and
 * pass keys through. Pure: works on screen text.
 */

export type ClaudePanel = {
  /** The panel's heading ("Manage MCP servers"); null when it opens on a tab bar. */
  title: string | null;
  /** The tab bar ("Settings · Status · Config · Usage · Stats"), when there is one. */
  tabs: string[] | null;
  /** The panel's body as drawn, common indent removed. */
  lines: string[];
  /** Index in `lines` of the row Claude's `❯` cursor is on. */
  selected: number | null;
  /** The key hint Claude prints at the bottom ("↑/↓ to navigate · Esc to cancel"). */
  hint: string | null;
};

const RULE = /^\s*▔{8,}/u;
const PROMPT_RULE = /^\s*─{10,}\s*$/u;
/** Claude's key hint line: it starts with a key, or names what a key does. */
const HINT =
  /^(?:esc|enter|tab|type|press|space|ctrl|shift|[↑↓←→])|\bto (?:navigate|confirm|cancel|close|select|go back|exit|toggle|switch|filter|scroll|tabs)\b/iu;
const TAB = /^[A-Z][\w-]*(?: [\w-]+)?$/u;

const blank = (line: string) => line.trim() === "";

/** The panel on `screen`, or null when Claude shows its normal prompt. */
export function parseClaudePanel(screen: string): ClaudePanel | null {
  const all = screen.split("\n");
  let rule = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (RULE.test(all[i])) {
      rule = i;
      break;
    }
  }
  if (rule < 0) return null;
  const body = all.slice(rule + 1);
  while (body.length > 0 && blank(body[body.length - 1])) body.pop();
  // The prompt box is back (a `───` rule above a `❯` line): no panel is open.
  for (let i = 0; i + 1 < body.length; i++) {
    if (PROMPT_RULE.test(body[i]) && body[i + 1].trimStart().startsWith("❯")) {
      return null;
    }
  }
  if (body.filter((l) => !blank(l)).length < 2) return null;

  const indent = Math.min(
    ...body
      .filter((l) => !blank(l))
      .map((l) => l.length - l.trimStart().length),
  );
  let lines = body.map((l) => l.slice(indent).trimEnd());
  while (lines.length > 0 && blank(lines[0])) lines.shift();

  let hint: string | null = null;
  const last = lines[lines.length - 1];
  if (last && HINT.test(last.trim())) {
    hint = last.trim();
    lines = lines.slice(0, -1);
    while (lines.length > 0 && blank(lines[lines.length - 1])) lines.pop();
  }

  let tabs: string[] | null = null;
  let title: string | null = null;
  const parts = (lines[0] ?? "").trim().split(/\s{2,}/u);
  if (parts.length >= 3 && parts.every((p) => p.length <= 20 && TAB.test(p))) {
    tabs = parts;
    lines = lines.slice(1);
  } else if (lines[0] && !lines[0].trimStart().startsWith("❯")) {
    title = lines[0].trim();
    lines = lines.slice(1);
  }
  while (lines.length > 0 && blank(lines[0])) lines.shift();

  const at = lines.findIndex((l) => l.trimStart().startsWith("❯"));
  return { title, tabs, lines, selected: at >= 0 ? at : null, hint };
}

export function samePanel(
  a: ClaudePanel | null,
  b: ClaudePanel | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.hint === b.hint &&
    a.selected === b.selected &&
    (a.tabs ?? []).join("\u0000") === (b.tabs ?? []).join("\u0000") &&
    a.lines.join("\n") === b.lines.join("\n")
  );
}

/** A key event, as the panel card sees it. */
export type PanelKey = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
};

const SPECIAL: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Enter: "\r",
  Escape: "\x1b",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
};

/**
 * The bytes a key sends to Claude's panel, as a terminal would; null for keys
 * the app keeps (Cmd shortcuts, bare modifiers).
 */
export function panelKeyBytes(e: PanelKey): string | null {
  if (e.metaKey) return null;
  if (e.key === "Tab") return e.shiftKey ? "\x1b[Z" : "\t";
  const special = SPECIAL[e.key];
  if (special) return special;
  if (e.key.length !== 1) return null;
  if (e.ctrlKey) {
    const code = e.key.toLowerCase().charCodeAt(0);
    return code >= 97 && code <= 122 ? String.fromCharCode(code - 96) : null;
  }
  return e.altKey ? `\x1b${e.key}` : e.key;
}
