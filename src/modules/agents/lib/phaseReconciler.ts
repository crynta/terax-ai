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
import { useAgentStore } from "../store/agentStore";
import { readScreen, reconcilePhase } from "./phaseRules";
import type { AgentStatus } from "./types";

const STATUS_FOR: Record<AgentPhase, AgentStatus> = {
  working: "working",
  attention: "waiting",
  finished: "done",
  idle: "idle",
};

/** How often every Claude pane's screen is read. */
export const RECONCILE_MS = 1500;
/** Reads in a row a session's pane is gone before the session is dropped. */
const ORPHAN_READS = 2;

/** Reads every Claude pane's screen on a timer and corrects its phase. */
export function usePhaseReconciler(): void {
  useEffect(() => {
    const quiet = new Map<number, number>();
    const orphans = new Map<number, number>();
    /** Each leaf's last seen phase and when it was first seen. */
    const seen = new Map<number, { phase: AgentPhase; since: number }>();
    const tick = () => {
      const now = Date.now();
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
        const last = seen.get(leafId);
        // A phase already set before Terax first looked counts as old: an
        // existing session that finished long ago settles on the first read.
        const since =
          last === undefined ? 0 : last.phase === phase ? last.since : now;
        seen.set(leafId, { phase, since });
        const text = leafScreenText(leafId);
        if (!text) continue;
        const next = reconcilePhase(
          phase,
          readScreen(text),
          quiet.get(leafId) ?? 0,
          now - since,
        );
        quiet.set(leafId, next.quietReads);
        if (next.phase === null) continue;
        settlePhase(ptyId, next.phase);
        seen.set(leafId, { phase: next.phase, since: now });
        agents.setStatus(leafId, STATUS_FOR[next.phase]);
      }
    };
    // Look straight away, so a session opened after it finished never
    // shows "Working" for a tick.
    tick();
    const timer = setInterval(tick, RECONCILE_MS);
    return () => clearInterval(timer);
  }, []);
}
