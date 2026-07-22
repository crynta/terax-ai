import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentSignal = { id: number; kind: string; agent?: string | null };

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  // pty -> agent name, learned from the `started` signal and kept until exit so
  // the tab can show that agent's brand icon while it runs.
  agents: Record<number, string>;
  setPhase: (id: number, phase: AgentPhase) => void;
  setAgent: (id: number, agent: string) => void;
  clear: (id: number) => void;
};

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  agents: {},
  setPhase: (id, phase) =>
    set((s) => {
      if (s.phases[id] === phase) return s;
      return { phases: { ...s.phases, [id]: phase } };
    }),
  setAgent: (id, agent) =>
    set((s) => {
      if (s.agents[id] === agent) return s;
      return { agents: { ...s.agents, [id]: agent } };
    }),
  clear: (id) =>
    set((s) => {
      if (!(id in s.phases) && !(id in s.agents)) return s;
      const phases = { ...s.phases };
      const agents = { ...s.agents };
      delete phases[id];
      delete agents[id];
      return { phases, agents };
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
    const { id, agent } = e.payload;
    const action = phaseForSignal(e.payload.kind);
    if (action === null) return;
    clearFinishedTimer(id);
    const store = useAgentActivityStore.getState();
    if (action === "exited") {
      store.clear(id);
      onExited?.(id);
      return;
    }
    // The agent name only rides the `started` signal (incl. self-arm).
    if (agent) store.setAgent(id, agent);
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
  state: "attention" | "working" | "finished" | null;
  // The running agent's name when state is "working", for its brand icon.
  agent: string | null;
};

// Highest-severity phase across the tab's ptys wins: attention > working >
// finished; idle/absent are ignored. When working, surface an agent name so the
// tab can show that agent's icon.
export function tabAgentStatus(
  phases: Record<number, AgentPhase>,
  agents: Record<number, string>,
  ptyIds: readonly number[],
): AgentTabStatus {
  let attention = false;
  let working = false;
  let finished = false;
  let workingAgent: string | null = null;
  for (const id of ptyIds) {
    const phase = phases[id];
    if (phase === "attention") attention = true;
    else if (phase === "working") {
      working = true;
      workingAgent ??= agents[id] ?? null;
    } else if (phase === "finished") finished = true;
  }
  if (attention) return { state: "attention", agent: null };
  if (working) return { state: "working", agent: workingAgent };
  if (finished) return { state: "finished", agent: null };
  return { state: null, agent: null };
}
