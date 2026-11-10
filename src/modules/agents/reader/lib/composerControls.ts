/**
 * The composer toolbar's model and mode pickers. Claude Code switches models
 * with `/model <alias>` and permission modes only by cycling Shift+Tab, so the
 * mode switch is a loop: press, re-read the footer, repeat until it matches.
 */

import type { PermissionMode } from "./claudeFooter";

export type ModelChoice = {
  /** What `/model` takes. */
  alias: string;
  label: string;
  detail: string;
};

export const MODEL_CHOICES: readonly ModelChoice[] = [
  {
    alias: "default",
    label: "Default",
    detail: "Your plan's recommended model",
  },
  { alias: "opus", label: "Opus", detail: "Most capable, for hard problems" },
  {
    alias: "sonnet",
    label: "Sonnet",
    detail: "Fast and capable, for everyday work",
  },
  { alias: "haiku", label: "Haiku", detail: "Fastest, for quick edits" },
  {
    alias: "opus[1m]",
    label: "Opus · 1M context",
    detail: "Opus with a 1M-token window",
  },
  {
    alias: "sonnet[1m]",
    label: "Sonnet · 1M context",
    detail: "Sonnet with a 1M-token window",
  },
];

/** The `/model` command for `alias`, or null for an empty or multi-word alias. */
export function modelCommand(alias: string): string | null {
  const clean = alias.trim();
  if (!clean || /\s/u.test(clean)) return null;
  return `/model ${clean}`;
}

/** The choice a friendly model name ("Opus 5.5", "Sonnet 4.5 (1M)") corresponds to. */
export function choiceForModel(name: string | null): ModelChoice | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  const wide = /\b1m\b|\[1m\]/u.test(lower);
  for (const family of ["opus", "sonnet", "haiku"]) {
    if (!lower.includes(family)) continue;
    const alias = wide ? `${family}[1m]` : family;
    return MODEL_CHOICES.find((c) => c.alias === alias) ?? null;
  }
  return null;
}

export type ModeChoice = {
  mode: PermissionMode;
  label: string;
  detail: string;
};

export const MODE_CHOICES: readonly ModeChoice[] = [
  {
    mode: "default",
    label: "Default",
    detail: "Ask before edits and commands",
  },
  {
    mode: "acceptEdits",
    label: "Accept edits",
    detail: "Edit files without asking",
  },
  { mode: "plan", label: "Plan", detail: "Read and plan, change nothing" },
  { mode: "auto", label: "Auto", detail: "Decide for itself when to ask" },
  { mode: "bypass", label: "Bypass", detail: "Never ask (only when enabled)" },
];

/** Most Shift+Tab presses tried before giving up on reaching a mode. */
export const MODE_CYCLE_MAX_PRESSES = 6;

/** The modes offered: bypass only while it is the current mode (it can't be turned on here). */
export function modeChoicesFor(current: PermissionMode | null): ModeChoice[] {
  return MODE_CHOICES.filter(
    (c) => c.mode !== "bypass" || current === "bypass",
  );
}

export type CycleStep =
  | { kind: "done" }
  | { kind: "press" }
  /** Wait and re-read: the footer was not readable this time. */
  | { kind: "wait" }
  | { kind: "fail"; reason: string };

/**
 * The next move while cycling toward `target`. `observed` is the mode read
 * after the last press (null when the footer isn't on screen); `misses`
 * counts consecutive unreadable reads.
 */
export function nextCycleStep(state: {
  target: PermissionMode;
  observed: PermissionMode | null;
  presses: number;
  misses: number;
  maxPresses?: number;
}): CycleStep {
  const max = state.maxPresses ?? MODE_CYCLE_MAX_PRESSES;
  if (state.observed === state.target) return { kind: "done" };
  if (state.observed === null) {
    return state.misses >= 3
      ? { kind: "fail", reason: "Claude's mode line isn't on screen." }
      : { kind: "wait" };
  }
  if (state.presses >= max) {
    return {
      kind: "fail",
      reason: `Couldn't switch to ${labelOf(state.target)} after ${max} tries. It may not be enabled for this session.`,
    };
  }
  return { kind: "press" };
}

function labelOf(mode: PermissionMode): string {
  return MODE_CHOICES.find((c) => c.mode === mode)?.label ?? mode;
}

/** Shift+Tab, as the terminal sends it. */
export const SHIFT_TAB = "\x1b[Z";
