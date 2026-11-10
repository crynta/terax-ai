/**
 * Keeps each Claude session's phase true to what its screen shows. Hooks miss
 * turns that end without a Stop (an Esc interrupt, an API error, a lost
 * marker), and the work that follows a permission answer fires no hook at
 * all, so a session could say "Working" long after it finished, or "Needs
 * you" while it worked.
 */
import {
  type AgentPhase,
  settlePhase,
  useAgentActivityStore,
} from "@/modules/terminal/lib/agentActivity";
import {
  leafScreenText,
  ptyIdForLeaf,
} from "@/modules/terminal/lib/terminalSessionApi";
import { useEffect } from "react";
import { parseClaudeActivity } from "../reader/lib/claudeActivity";
import { parseClaudeDialog } from "../reader/lib/claudeDialog";
import { parseClaudeFooter } from "../reader/lib/claudeFooter";
import { useAgentStore } from "../store/agentStore";
import type { AgentStatus } from "./types";

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

/** Reads in a row showing a finished turn before "working" is dropped. */
export const DONE_READS = 2;
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
): { phase: AgentPhase | null; quietReads: number } {
  if (read.dialog) {
    return { phase: phase === "working" ? "attention" : null, quietReads: 0 };
  }
  if (read.busy) {
    return { phase: phase === "working" ? null : "working", quietReads: 0 };
  }
  if (phase !== "working") return { phase: null, quietReads: 0 };
  const quiet = quietReads + 1;
  const needed = read.done || read.footer ? DONE_READS : GONE_READS;
  return quiet >= needed
    ? { phase: "finished", quietReads: 0 }
    : { phase: null, quietReads: quiet };
}

const STATUS_FOR: Record<AgentPhase, AgentStatus> = {
  working: "working",
  attention: "waiting",
  finished: "done",
  idle: "idle",
};

/** How often every Claude pane's screen is read. */
export const RECONCILE_MS = 2000;
/** Reads in a row a session's pane is gone before the session is dropped. */
const ORPHAN_READS = 2;

/** Reads every Claude pane's screen on a timer and corrects its phase. */
export function usePhaseReconciler(): void {
  useEffect(() => {
    const quiet = new Map<number, number>();
    const orphans = new Map<number, number>();
    const tick = () => {
      const agents = useAgentStore.getState();
      const phases = useAgentActivityStore.getState().phases;
      for (const session of Object.values(agents.sessions)) {
        if (session.agent !== "claude") continue;
        const leafId = session.leafId;
        const ptyId = ptyIdForLeaf(leafId);
        if (ptyId === null) {
          // The pane closed and its exit signal found no leaf to report.
          const misses = (orphans.get(leafId) ?? 0) + 1;
          orphans.set(leafId, misses);
          if (misses >= ORPHAN_READS) {
            orphans.delete(leafId);
            quiet.delete(leafId);
            agents.finish(leafId);
          }
          continue;
        }
        orphans.delete(leafId);
        const phase = phases[ptyId];
        if (phase === undefined) continue;
        const text = leafScreenText(leafId);
        if (!text) continue;
        const next = reconcilePhase(
          phase,
          readScreen(text),
          quiet.get(leafId) ?? 0,
        );
        quiet.set(leafId, next.quietReads);
        if (next.phase === null) continue;
        settlePhase(ptyId, next.phase);
        agents.setStatus(leafId, STATUS_FOR[next.phase]);
      }
    };
    const timer = setInterval(tick, RECONCILE_MS);
    return () => clearInterval(timer);
  }, []);
}
