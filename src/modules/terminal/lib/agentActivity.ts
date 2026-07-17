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

/** Maps a raw detector signal to the phase it drives, `"exited"` to drop the
 * pty, or `null` to ignore. Pure so the mapping stays unit-testable. */
export function phaseForSignal(
  kind: string,
): Exclude<AgentPhase, "idle"> | "exited" | null {
  switch (kind) {
    case "started":
    case "working":
      return "working";
    case "attention":
      return "attention";
    case "finished":
      return "finished";
    case "exited":
      return "exited";
    default:
      return null;
  }
}

// The Rust detector arms via the Claude Code / Codex / Gemini OSC 777 marker and
// reports per-pty lifecycle: started, working, attention, finished, exited.
export function ensureAgentActivityListener(
  exited: (ptyId: number) => void,
): void {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<AgentSignal>("terax:agent-signal", (e) => {
    const { id } = e.payload;
    const action = phaseForSignal(e.payload.kind);
    if (action === null) return;
    clearFinishedTimer(id);
    const store = useAgentActivityStore.getState();
    if (action === "exited") {
      store.clear(id);
      onExited?.(id);
      return;
    }
    store.setPhase(id, action);
    if (action === "finished") {
      finishedTimers.set(
        id,
        setTimeout(() => {
          finishedTimers.delete(id);
          const s = useAgentActivityStore.getState();
          if (s.phases[id] === "finished") s.setPhase(id, "idle");
        }, FINISHED_TTL_MS),
      );
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

// Highest-severity phase wins the dot; `count` is how many agents share it, so
// the number always matches what the dot represents (never over-counts across
// phases). attention > working > finished; idle/absent are ignored.
export function aggregateAgentPhases(
  phases: Record<number, AgentPhase>,
  ptyIds: readonly number[],
): AgentTabStatus {
  const counts = { attention: 0, working: 0, finished: 0 };
  for (const id of ptyIds) {
    const phase = phases[id];
    if (phase === "attention" || phase === "working" || phase === "finished") {
      counts[phase]++;
    }
  }
  const top: AgentTabStatus["top"] =
    counts.attention > 0
      ? "attention"
      : counts.working > 0
        ? "working"
        : counts.finished > 0
          ? "finished"
          : null;
  return { top, count: top ? counts[top] : 0 };
}
