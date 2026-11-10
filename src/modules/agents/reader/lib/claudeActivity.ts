/**
 * Reads Claude Code's live activity line, the spinner just above its input box:
 *
 *   ✽ Cogitating… (12s · ↓ 3.1k tokens · esc to interrupt)
 *   ✻ Waiting for 1 background agent to finish
 *   ✻ Cooked for 14m 37s · done 11:45 PM
 */

import { cleanScreenLine } from "./claudeDialog";

export type ClaudeActivity = {
  /** "Cogitating…", "Waiting", "Cooked". */
  verb: string;
  /** Plain sentence for the row: "Waiting for 1 background agent", "Finished in 14m 37s". */
  detail: string | null;
  elapsed: string | null;
  tokens: string | null;
  /** ↑ tokens sent, ↓ tokens received. */
  direction: "up" | "down" | null;
  /** Background agents or tasks Claude is waiting on. */
  waitingFor: number | null;
  /** The turn finished ("Cooked for 14m 37s"). */
  done: boolean;
  /** Clock time from "· done 11:45 PM". */
  doneAt: string | null;
  /** Esc stops it (the line says "esc to interrupt"). */
  interruptible: boolean;
};

const GLYPHS = "✻✽✶✳✢·*✺✹✸";
const SPINNER = new RegExp(`^\\s*[${GLYPHS}]\\s+(\\S.*)$`, "u");
const RULE = /^[\s─━]*[─━]{8,}/u;
const PROMPT = /^\s*[❯>]\s?/u;
const SPAN = /^(?:\d+d\s?)?(?:\d+h\s?)?(?:\d+m\s?)?(?:\d+(?:\.\d+)?s)?$/u;
const WAITING =
  /^Waiting for (\d+) background (agents?|tasks?|shells?)(?: to finish)?/iu;
const DONE =
  /^([A-Z][a-z]+(?:ed|t))\s+for\s+((?:\d+[dhms]\s?)+?)\s*(?:·\s*done\s+(.+?))?\s*$/u;
const WORKING =
  /^([A-Z][\p{L}'-]*(?:\s[\p{L}'-]+)?)(?:…|\.\.\.)\s*(?:\((.*)\))?\s*$/u;
const TOKENS = /([↑↓])\s*([\d.,]+\s?[kKmM]?)\s*tokens/u;

/** Lines searched above the input box (or the bottom, without one). */
const REACH = 6;

/** Parses one activity line, or null when it isn't one. */
export function parseActivityLine(raw: string): ClaudeActivity | null {
  const m = SPINNER.exec(cleanScreenLine(raw));
  if (!m) return null;
  const rest = m[1].trim();

  const waiting = WAITING.exec(rest);
  if (waiting) {
    const n = Number(waiting[1]);
    const noun = waiting[2].toLowerCase().replace(/s$/u, "");
    return {
      verb: "Waiting",
      detail: `Waiting for ${n} background ${noun}${n === 1 ? "" : "s"}`,
      elapsed: null,
      tokens: null,
      direction: null,
      waitingFor: n,
      done: false,
      doneAt: null,
      interruptible: /esc to interrupt/iu.test(rest),
    };
  }

  const done = DONE.exec(rest);
  if (done) {
    const elapsed = done[2].trim();
    return {
      verb: done[1],
      detail: `Finished in ${elapsed}`,
      elapsed,
      tokens: null,
      direction: null,
      waitingFor: null,
      done: true,
      doneAt: done[3]?.trim() || null,
      interruptible: false,
    };
  }

  const working = WORKING.exec(rest);
  if (!working) return null;
  const parts = (working[2] ?? "").split("·").map((p) => p.trim());
  const elapsed = parts.find((p) => p && SPAN.test(p)) ?? null;
  const tokens = TOKENS.exec(working[2] ?? "");
  return {
    verb: `${working[1]}…`,
    detail: null,
    elapsed,
    tokens: tokens ? tokens[2].replace(/\s/gu, "") : null,
    direction: tokens ? (tokens[1] === "↑" ? "up" : "down") : null,
    waitingFor: null,
    done: false,
    doneAt: null,
    interruptible: /esc to interrupt/iu.test(working[2] ?? ""),
  };
}

/** The activity line just above the input box on `screen`, or null. */
export function parseClaudeActivity(screen: string): ClaudeActivity | null {
  const lines = screen.split("\n");
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  // The input box's top rule: the rule above the bottom-most prompt line.
  let top = -1;
  for (let i = end - 1; i >= Math.max(0, end - 40) && top < 0; i--) {
    if (!PROMPT.test(cleanScreenLine(lines[i]))) continue;
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      if (RULE.test(cleanScreenLine(lines[j]))) {
        top = j;
        break;
      }
    }
  }
  const from = top >= 0 ? top - 1 : end - 1;
  for (let i = from; i >= Math.max(0, from - REACH); i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    const activity = parseActivityLine(line);
    if (activity) return activity;
  }
  return null;
}

export function sameActivity(
  a: ClaudeActivity | null,
  b: ClaudeActivity | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.verb === b.verb &&
    a.detail === b.detail &&
    a.elapsed === b.elapsed &&
    a.tokens === b.tokens &&
    a.direction === b.direction &&
    a.waitingFor === b.waitingFor &&
    a.done === b.done &&
    a.doneAt === b.doneAt &&
    a.interruptible === b.interruptible
  );
}
