/**
 * The rules that keep a Claude session's phase true to its screen, shared by
 * Terax (reading its own panes) and the VS Code extension (reading its copy
 * of the terminal). Pure: no stores, no timers.
 */
import { parseClaudeActivity } from "../reader/lib/claudeActivity";
import { parseClaudeDialog } from "../reader/lib/claudeDialog";
import { parseClaudeFooter } from "../reader/lib/claudeFooter";

/**
 * An agent's phase, as `AgentPhase` in the terminal module spells it; kept
 * here so this file has no app imports (the VS Code host bundles it).
 */
type AgentPhase = "working" | "attention" | "finished" | "idle";

/** What one read of a Claude pane's screen shows. */
export type ScreenRead = {
  /** The spinner line says Claude is on a turn (not "Cooked for 2m"). */
  busy: boolean;
  /** The spinner line says the turn is over. */
  done: boolean;
  /** Claude's input box and footer are on screen. */
  footer: boolean;
  /** A permission or question dialog is on screen. */
  dialog: boolean;
};

export function readScreen(text: string): ScreenRead {
  const activity = parseClaudeActivity(text);
  return {
    busy: activity !== null && !activity.done,
    done: activity?.done ?? false,
    footer: parseClaudeFooter(text) !== null,
    dialog: parseClaudeDialog(text) !== null,
  };
}

/**
 * Reads in a row showing a finished turn before "working" is dropped, while
 * the turn is young: the spinner can lag the prompt by a moment.
 */
export const DONE_READS = 2;
/**
 * After this long in "working" (or when the session was already working
 * before Terax first looked at it), one read showing a finished turn is
 * enough.
 */
export const SETTLED_MS = 3000;
/** Reads in a row without any of Claude's screen (it exited, or a full-screen
 *  panel is up) before "working" is dropped. */
export const GONE_READS = 5;

/**
 * The phase `read` calls for, or null to leave `phase` alone, and the count
 * of reads in a row that showed no work while the phase said working.
 */
export function reconcilePhase(
  phase: AgentPhase | undefined,
  read: ScreenRead,
  quietReads: number,
  /** How long the phase has been what it is; Infinity when unknown. */
  phaseAgeMs = Number.POSITIVE_INFINITY,
): { phase: AgentPhase | null; quietReads: number } {
  if (read.dialog) {
    return { phase: phase === "working" ? "attention" : null, quietReads: 0 };
  }
  if (read.busy) {
    return { phase: phase === "working" ? null : "working", quietReads: 0 };
  }
  if (phase !== "working") return { phase: null, quietReads: 0 };
  const quiet = quietReads + 1;
  const needed =
    read.done || read.footer
      ? phaseAgeMs >= SETTLED_MS
        ? 1
        : DONE_READS
      : GONE_READS;
  return quiet >= needed
    ? { phase: "finished", quietReads: 0 }
    : { phase: null, quietReads: quiet };
}
