/**
 * Reads Claude Code's footer off the pane's screen: the user's status line, the
 * permission mode and the agents list, all printed under the input box:
 *
 *   ──────────────────────────────────────────────
 *   ❯ _
 *   ──────────────────────────────────────────────
 *     Meesho 🛠️ Opus 5.5 | 📁 Notes | 🧠 [█████░░░░░] 57% | 💰 $117.28 | +9973/-371
 *     ⏵⏵ auto mode on (shift+tab to cycle)
 *
 *     ⏺ main
 *     ◯ fork  Blocking send during open dialog     7m 26s · ↓ 615.5k tokens
 */

import { cleanScreenLine } from "./claudeDialog";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "bypass";

export type FooterChip =
  | {
      kind: "model";
      text: string;
      model: string;
      /** A label before the model, like an org or user name ("Meesho"). */
      account?: string;
    }
  | { kind: "folder"; text: string; folder: string }
  | { kind: "context"; text: string; percent: number }
  | { kind: "cost"; text: string; cost: string }
  | { kind: "lines"; text: string; added: number; removed: number }
  | { kind: "duration"; text: string; duration: string }
  | { kind: "text"; text: string };

export type FooterAgent = {
  name: string;
  title: string | null;
  elapsed: string | null;
  tokens: string | null;
  /** The one the footer marks as current (⏺). */
  active: boolean;
};

export type ClaudeFooter = {
  /** The status line as printed, one entry per line: for change detection, never shown. */
  statusline: string[];
  chips: FooterChip[];
  mode: PermissionMode;
  agents: FooterAgent[];
};

/** Lines from the bottom searched for the input box and footer. */
const SCAN_LINES = 40;

const RULE = /^[\s─━]*[─━]{8,}/u;
const PROMPT = /^\s*[❯>]\s?/u;
const MODE_LINE =
  /(auto mode on|accept edits on|plan mode on|bypass permissions on)/iu;
const AGENT_LINE = /^\s*([⏺◯●○])\s+(\S+)(.*)$/u;
const BACKGROUND_LINE = /(\d+)\s+(?:background|bg)\s+(task|shell|bash)/iu;
const HINT_LINE =
  /^\s*(\?\s+for shortcuts|esc to (?:interrupt|cancel)|press .+ to|enter to|tab to|ctrl\+)/iu;
/**
 * Emoji and their combiners only: pictographs, variation selectors, ZWJ,
 * keycaps, skin tones, tags and flag letters. Letters next to them stay.
 */
const EMOJI =
  /\p{Extended_Pictographic}|\u{FE0E}|\u{FE0F}|\u{200D}|\u{20E3}|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}]|\p{Regional_Indicator}/gu;
const BAR = /[█▉▊▋▌▍▎▏░▒▓■□▪▫]/u;

const MODES: Array<[RegExp, PermissionMode]> = [
  [/accept edits on/iu, "acceptEdits"],
  [/plan mode on/iu, "plan"],
  [/auto mode on/iu, "auto"],
  [/bypass permissions on/iu, "bypass"],
];

function modeOf(line: string): PermissionMode | null {
  for (const [re, mode] of MODES) if (re.test(line)) return mode;
  return null;
}

/** `s` without emoji, with runs of spaces collapsed. */
export function stripEmoji(s: string): string {
  return s.replace(EMOJI, "").replace(/\s+/gu, " ").trim();
}

const plain = stripEmoji;

/**
 * One status-line segment as a chip, recognised by its emoji or shape. `text`
 * never keeps emoji or progress-bar glyphs; null for a segment with no value
 * left once those are stripped.
 */
export function footerChip(segment: string): FooterChip | null {
  const raw = segment.trim();
  const text = plain(
    raw.replace(/\[[^\]]*\]/gu, (m) => (BAR.test(m) ? "" : m)),
  );
  if (!text) return null;
  const percent = /(\d{1,3})\s?%/u.exec(text);
  if (percent && (BAR.test(raw) || /🧠|ctx|context/iu.test(raw))) {
    return {
      kind: "context",
      text,
      percent: Math.min(100, Number(percent[1])),
    };
  }
  const cost = /\$\s?\d[\d,]*(?:\.\d+)?/u.exec(text);
  if (cost && (/💰/u.test(raw) || text === cost[0])) {
    return { kind: "cost", text, cost: cost[0].replace(/\s/gu, "") };
  }
  const lines = /^\+([\d,]+)\s*\/\s*-([\d,]+)$/u.exec(text);
  if (lines) {
    return {
      kind: "lines",
      text,
      added: Number(lines[1].replace(/,/gu, "")),
      removed: Number(lines[2].replace(/,/gu, "")),
    };
  }
  if (/⏱/u.test(raw) || DURATION.test(text)) {
    return { kind: "duration", text, duration: formatFooterDuration(text) };
  }
  if (/📁|📂/u.test(raw)) return { kind: "folder", text, folder: text };
  const model = MODEL.exec(text);
  if (model) {
    const name = `${MODEL_NAMES[model[1].toLowerCase()] ?? model[1]}${model[0].slice(model[1].length)}`;
    const account = text.slice(0, model.index).trim();
    return account
      ? { kind: "model", text, model: name, account }
      : { kind: "model", text, model: name };
  }
  // A label with nothing but punctuation left carries no value.
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return { kind: "text", text };
}

/**
 * A model name, also when a wide emoji right before it cost the screen its
 * first letter ("🛠️ Opus" read as "pus"); MODEL_NAMES restores the name.
 */
const MODEL =
  /\b(o?pus|s?onnet|h?aiku|fable|claude)\b(?:\s[\d.]+)?(?:\s?\(1M\))?/iu;
const MODEL_NAMES: Record<string, string> = {
  opus: "Opus",
  pus: "Opus",
  sonnet: "Sonnet",
  onnet: "Sonnet",
  haiku: "Haiku",
  aiku: "Haiku",
  fable: "Fable",
  claude: "Claude",
};

const DURATION = /^(?:\d+d\s?)?(?:\d+h\s?)?(?:\d+m)?(?:\s?\d+s)?$/u;

/** Seconds in a "193h43m" / "7m 26s" / "1d 2h" span, or null when it isn't one. */
export function durationSeconds(span: string): number | null {
  const s = span.replace(/\s+/gu, "");
  if (!s || !DURATION.test(s)) return null;
  const part = (unit: string) =>
    Number(new RegExp(`(\\d+)${unit}`, "u").exec(s)?.[1] ?? 0);
  const total =
    part("d") * 86_400 + part("h") * 3_600 + part("m") * 60 + part("s");
  return total > 0 || /0/u.test(s) ? total : null;
}

/** "193h43m" → "8d 1h" past 48 h, else "193h 43m"-style with a space between units. */
export function formatFooterDuration(span: string): string {
  const seconds = durationSeconds(span);
  if (seconds === null) return span.trim();
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (seconds >= 48 * 3_600) return `${d}d ${h}h`;
  if (seconds >= 3_600) return `${d * 24 + h}h ${m}m`;
  if (seconds >= 60) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function agentAt(line: string): FooterAgent | null {
  const m = AGENT_LINE.exec(line);
  if (!m) return null;
  const parts = m[3]
    .split(/\s{2,}/u)
    .map((p) => p.trim())
    .filter(Boolean);
  const meta = parts.find((p) => /tokens|·|\d+[hms]\b/u.test(p)) ?? null;
  const title = plain(parts.find((p) => p !== meta) ?? "") || null;
  const tokens = meta
    ? (/↓\s*([\d.,]+\s?[kKmM]?)\s*tokens/u.exec(meta)?.[1] ?? null)
    : null;
  const elapsed = meta ? meta.split("·")[0].trim() || null : null;
  return {
    name: m[2],
    title,
    elapsed: elapsed && /\d/u.test(elapsed) ? elapsed : null,
    tokens: tokens ? tokens.replace(/\s/gu, "") : null,
    active: m[1] === "⏺" || m[1] === "●",
  };
}

/** The index of the line after the input box's bottom rule, or -1. */
function belowInputBox(lines: string[], from: number): number {
  for (let i = lines.length - 1; i > from; i--) {
    if (!RULE.test(lines[i])) continue;
    for (let j = i - 1; j >= Math.max(from, i - 12); j--) {
      if (RULE.test(lines[j])) break;
      if (PROMPT.test(lines[j])) return i + 1;
    }
  }
  return -1;
}

/** Parses the footer on `screen`, or null when none is visible. */
export function parseClaudeFooter(screen: string): ClaudeFooter | null {
  const lines = screen.split("\n").map(cleanScreenLine);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  const from = Math.max(0, end - SCAN_LINES);
  let start = belowInputBox(lines.slice(0, end), from);
  if (start < 0) {
    // No input box (a dialog replaced it): start at the status line above the mode line.
    const modeAt = lines.slice(from, end).findIndex((l) => MODE_LINE.test(l));
    if (modeAt < 0) return null;
    start = from + modeAt;
    while (start > from && / \| /u.test(lines[start - 1])) start--;
  }

  const statusline: string[] = [];
  const agents: FooterAgent[] = [];
  let mode: PermissionMode = "default";
  for (const line of lines.slice(start, end)) {
    if (!line.trim()) continue;
    const lineMode = modeOf(line);
    if (lineMode) {
      mode = lineMode;
      continue;
    }
    const agent = agentAt(line);
    if (agent) {
      agents.push(agent);
      continue;
    }
    const background = BACKGROUND_LINE.exec(line);
    if (background) {
      agents.push({
        name: "background",
        title: plain(line),
        elapsed: null,
        tokens: null,
        active: false,
      });
      continue;
    }
    if (HINT_LINE.test(line) || RULE.test(line)) continue;
    if (agents.length === 0) statusline.push(line.trim());
  }
  if (statusline.length === 0 && agents.length === 0 && mode === "default") {
    return null;
  }
  const chips = statusline.flatMap((line) =>
    line.split(/\s+\|\s+/u).flatMap((segment) => {
      const chip = footerChip(segment);
      return chip ? [chip] : [];
    }),
  );
  return { statusline, chips, mode, agents };
}

/** Same footer: unchanged lines, mode and agents (cheap check before re-rendering). */
export function sameFooter(
  a: ClaudeFooter | null,
  b: ClaudeFooter | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  if (a.statusline.join("\n") !== b.statusline.join("\n")) return false;
  if (a.agents.length !== b.agents.length) return false;
  return a.agents.every((x, i) => {
    const y = b.agents[i];
    return (
      x.name === y.name &&
      x.title === y.title &&
      x.elapsed === y.elapsed &&
      x.tokens === y.tokens &&
      x.active === y.active
    );
  });
}

export const MODE_LABELS: Record<PermissionMode, string> = {
  default: "Ask before edits",
  acceptEdits: "Accept edits",
  plan: "Plan mode",
  auto: "Auto mode",
  bypass: "Bypass permissions",
};
