import type { ClaudeFooter, FooterAgent, PermissionMode } from "./claudeFooter";
import type { SessionInfo } from "./sessionInfo";

/** One set of session facts for the strip and the full-view card. */
export type SessionFacts = {
  mode: PermissionMode | null;
  model: string | null;
  /** An org or user label shown before the model in the status line. */
  account: string | null;
  folder: string | null;
  contextPercent: number | null;
  cost: string | null;
  added: number | null;
  removed: number | null;
  duration: string | null;
  /** Status-line segments the Reader doesn't recognise, emoji stripped. */
  extras: string[];
  agents: FooterAgent[];
  /** Whether Claude Code's footer was on screen (its values win over the transcript's). */
  fromFooter: boolean;
};

const COUNT = new Intl.NumberFormat("en-US");

/** "9973" → "9,973". */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/**
 * The footer's values where it shows them, else those derived from the
 * transcript (`info`), with `duration` and `folder` as the last fallbacks.
 */
export function sessionFacts(
  footer: ClaudeFooter | null,
  info: SessionInfo,
  duration: string | null,
  folder: string | null,
): SessionFacts {
  const chip = <K extends ClaudeFooter["chips"][number]["kind"]>(kind: K) =>
    footer?.chips.find((c) => c.kind === kind) as
      | Extract<ClaudeFooter["chips"][number], { kind: K }>
      | undefined;
  const lines = chip("lines");
  const model = chip("model")?.model ?? info.model;
  const repeatsModel = (text: string) =>
    model !== null && text.toLowerCase().includes(model.toLowerCase());
  const hasLines = Boolean(lines) || info.added > 0 || info.removed > 0;
  return {
    mode: footer?.mode ?? null,
    model,
    account: chip("model")?.account ?? null,
    folder: chip("folder")?.folder ?? folder,
    contextPercent: chip("context")?.percent ?? info.contextPercent,
    cost: chip("cost")?.cost ?? null,
    added: hasLines ? (lines?.added ?? info.added) : null,
    removed: hasLines ? (lines?.removed ?? info.removed) : null,
    duration: chip("duration")?.duration ?? duration,
    extras: (footer?.chips ?? []).flatMap((c) =>
      c.kind === "text" && !repeatsModel(c.text) ? [c.text] : [],
    ),
    agents: footer?.agents ?? [],
    fromFooter: footer !== null,
  };
}

/** Context meter colour: accent, amber from 70 %, red from 90 %. */
export function contextTone(percent: number): "ok" | "warn" | "high" {
  if (percent >= 90) return "high";
  if (percent >= 70) return "warn";
  return "ok";
}
