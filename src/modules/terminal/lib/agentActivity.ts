import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentSignal = {
  id: number;
  kind: string;
  agent?: string | null;
  /** The agent's own session id (UUID), on `linked` signals only. */
  session?: string | null;
};

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  // pty -> agent name, learned from the `started` signal and kept until exit so
  // the tab can show that agent's brand icon while it runs.
  agents: Record<number, string>;
  // pty -> the agent's session id (Claude's transcript), learned from `linked`.
  sessionIds: Record<number, string>;
  setPhase: (id: number, phase: AgentPhase) => void;
  setAgent: (id: number, agent: string) => void;
  setSessionId: (id: number, sessionId: string) => void;
  acknowledgeAttention: (ids: readonly number[]) => void;
  clear: (id: number) => void;
};

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  agents: {},
  sessionIds: {},
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
  setSessionId: (id, sessionId) =>
    set((s) => {
      if (s.sessionIds[id] === sessionId) return s;
      return { sessionIds: { ...s.sessionIds, [id]: sessionId } };
    }),
  acknowledgeAttention: (ids) =>
    set((s) => {
      let phases: Record<number, AgentPhase> | null = null;
      for (const id of ids) {
        if (s.phases[id] !== "attention") continue;
        phases ??= { ...s.phases };
        phases[id] = "idle";
      }
      return phases ? { phases } : s;
    }),
  clear: (id) =>
    set((s) => {
      if (!(id in s.phases) && !(id in s.agents) && !(id in s.sessionIds)) {
        return s;
      }
      const phases = { ...s.phases };
      const agents = { ...s.agents };
      const sessionIds = { ...s.sessionIds };
      delete phases[id];
      delete agents[id];
      delete sessionIds[id];
      return { phases, agents, sessionIds };
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

let listenerReady: Promise<void> | null = null;

export function clearAgentActivity(id: number): void {
  clearFinishedTimer(id);
  useAgentActivityStore.getState().clear(id);
}

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

type AgentSignalHandler = (signal: AgentSignal) => void;
const signalHandlers = new Set<AgentSignalHandler>();

/**
 * Subscribes to every raw detector signal through the single shared native
 * `terax:agent-signal` listener (the activity store has already applied the
 * signal when handlers run). One listener serves the tab icons and the
 * notification bridge instead of one IPC subscription each.
 */
export function subscribeAgentSignals(handler: AgentSignalHandler): () => void {
  signalHandlers.add(handler);
  void ensureAgentActivityListener().catch(() => {});
  return () => {
    signalHandlers.delete(handler);
  };
}

function applySignal(payload: AgentSignal): void {
  const { id, agent } = payload;
  if (payload.kind === "linked") {
    if (payload.session) {
      useAgentActivityStore.getState().setSessionId(id, payload.session);
    }
    return;
  }
  const action = phaseForSignal(payload.kind);
  if (action === null) return;
  clearFinishedTimer(id);
  const store = useAgentActivityStore.getState();
  if (action === "exited") {
    store.clear(id);
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
}

// The Rust detector arms via the Claude Code / Codex / Gemini OSC 777 marker and
// reports per-pty lifecycle: started, working, attention, finished, exited.
export function ensureAgentActivityListener(): Promise<void> {
  if (listenerReady) return listenerReady;
  listenerReady = listen<AgentSignal>("terax:agent-signal", (e) => {
    applySignal(e.payload);
    for (const handler of signalHandlers) {
      try {
        handler(e.payload);
      } catch (error) {
        console.error("[terax] agent signal handler failed:", error);
      }
    }
  }).then(
    () => {},
    (error: unknown) => {
      listenerReady = null;
      throw error;
    },
  );
  return listenerReady;
}

export function isAgentActivePty(ptyId: number): boolean {
  return ptyId in useAgentActivityStore.getState().phases;
}

export type AgentTabStatus = {
  state: "attention" | "working" | "finished" | "idle" | null;
  // The running agent's name when its brand icon should be shown.
  agent: string | null;
};

// Highest-severity phase across the tab's ptys wins: attention > working >
// finished > idle. Surface an agent name for working and acknowledged idle
// sessions so the tab keeps the active agent's brand icon.
export function tabAgentStatus(
  phases: Record<number, AgentPhase>,
  agents: Record<number, string>,
  ptyIds: readonly number[],
): AgentTabStatus {
  let attention = false;
  let working = false;
  let finished = false;
  let idle = false;
  let workingAgent: string | null = null;
  let idleAgent: string | null = null;
  for (const id of ptyIds) {
    const phase = phases[id];
    if (phase === "attention") attention = true;
    else if (phase === "working") {
      working = true;
      workingAgent ??= agents[id] ?? null;
    } else if (phase === "finished") finished = true;
    else if (phase === "idle") {
      const agent = agents[id];
      if (agent) {
        idle = true;
        idleAgent ??= agent;
      }
    }
  }
  if (attention) return { state: "attention", agent: null };
  if (working) return { state: "working", agent: workingAgent };
  if (finished) return { state: "finished", agent: null };
  if (idle) return { state: "idle", agent: idleAgent };
  return { state: null, agent: null };
}
