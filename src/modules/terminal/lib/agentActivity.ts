import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentSignal = { id: number; kind: string };

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  setPhase: (id: number, phase: AgentPhase) => void;
  clear: (id: number) => void;
};

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  setPhase: (id, phase) =>
    set((s) => {
      if (s.phases[id] === phase) return s;
      return { phases: { ...s.phases, [id]: phase } };
    }),
  clear: (id) =>
    set((s) => {
      if (!(id in s.phases)) return s;
      const next = { ...s.phases };
      delete next[id];
      return { phases: next };
    }),
}));

const FINISHED_TTL_MS = 6000;
const finishedTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearFinishedTimer(id: number): void {
  const t = finishedTimers.get(id);
  if (t) {
    clearTimeout(t);
    finishedTimers.delete(id);
  }
}

let onExited: ((ptyId: number) => void) | null = null;
let bound = false;

// The Rust detector arms via the Claude Code / Codex / Gemini OSC 777 marker and
// reports per-pty lifecycle: started, working, attention, finished, exited.
export function ensureAgentActivityListener(
  exited: (ptyId: number) => void,
): void {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<AgentSignal>("terax:agent-signal", (e) => {
    const { id, kind } = e.payload;
    const store = useAgentActivityStore.getState();
    switch (kind) {
      case "started":
      case "working":
        clearFinishedTimer(id);
        store.setPhase(id, "working");
        break;
      case "attention":
        clearFinishedTimer(id);
        store.setPhase(id, "attention");
        break;
      case "finished":
        clearFinishedTimer(id);
        store.setPhase(id, "finished");
        finishedTimers.set(
          id,
          setTimeout(() => {
            finishedTimers.delete(id);
            const s = useAgentActivityStore.getState();
            if (s.phases[id] === "finished") s.setPhase(id, "idle");
          }, FINISHED_TTL_MS),
        );
        break;
      case "exited":
        clearFinishedTimer(id);
        store.clear(id);
        onExited?.(id);
        break;
    }
  });
}

export function isAgentActivePty(ptyId: number): boolean {
  return ptyId in useAgentActivityStore.getState().phases;
}

export type AgentTabStatus = {
  top: "attention" | "working" | "finished" | null;
  count: number;
};

const PRIORITY: Record<Exclude<AgentPhase, "idle">, number> = {
  attention: 3,
  working: 2,
  finished: 1,
};

export function aggregateAgentPhases(
  phases: Record<number, AgentPhase>,
  ptyIds: readonly number[],
): AgentTabStatus {
  let top: AgentTabStatus["top"] = null;
  let topRank = 0;
  let count = 0;
  for (const id of ptyIds) {
    const phase = phases[id];
    if (!phase || phase === "idle") continue;
    if (phase === "working" || phase === "attention") count++;
    const rank = PRIORITY[phase];
    if (rank > topRank) {
      topRank = rank;
      top = phase;
    }
  }
  return { top, count };
}
