/**
 * The Terax stores the Reader reads, fed from the host's terminal state:
 * `agentActivity` (phase and session id per pty), `agentStore` (the Claude
 * session per pane) and the one preference the Reader needs.
 */
import { create } from "zustand";
import { hostState, onLeafChange, rpc } from "../bridge";
import type { LeafState } from "../../src/protocol";
import { writeToSession } from "./terminalSessionApi";

// ---- @/modules/terminal/lib/agentActivity
export type AgentPhase = "working" | "attention" | "finished" | "idle";

type AgentActivityStore = {
  phases: Record<number, AgentPhase>;
  agents: Record<number, string>;
  sessionIds: Record<number, string>;
  acknowledgeAttention: (ids: readonly number[]) => void;
};

export const useAgentActivityStore = create<AgentActivityStore>((set) => ({
  phases: {},
  agents: {},
  sessionIds: {},
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
}));

export function isAgentActivePty(ptyId: number): boolean {
  return ptyId in useAgentActivityStore.getState().phases;
}

// ---- @/modules/agents/store/agentStore
type AgentSession = {
  leafId: number;
  agent: string;
  claudeSessionId: string | null;
  startedAt: number;
};

export const useAgentStore = create<{ sessions: Record<number, AgentSession> }>(() => ({
  sessions: {},
}));

function apply(leaf: LeafState | null, leafId: number): void {
  useAgentActivityStore.setState((s) => {
    const phases = { ...s.phases };
    const agents = { ...s.agents };
    const sessionIds = { ...s.sessionIds };
    delete phases[leafId];
    delete agents[leafId];
    delete sessionIds[leafId];
    if (leaf?.alive && leaf.phase) {
      phases[leafId] = leaf.phase;
      agents[leafId] = "claude";
      if (leaf.sessionId) sessionIds[leafId] = leaf.sessionId;
    }
    return { phases, agents, sessionIds };
  });
  useAgentStore.setState((s) => {
    const sessions = { ...s.sessions };
    if (!leaf || leaf.startedAt === null) delete sessions[leafId];
    else {
      sessions[leafId] = {
        leafId,
        agent: "claude",
        claudeSessionId: leaf.sessionId,
        startedAt: leaf.startedAt,
      };
    }
    return { sessions };
  });
}

onLeafChange(apply);
for (const [id, leaf] of hostState.leaves) apply(leaf, id);

// ---- @/modules/settings/preferences
type Prefs = { agentLaunchCommands: Record<string, string> };

export const usePreferencesStore = create<Prefs>(() => ({
  agentLaunchCommands: { claude: "claude" },
}));

// ---- @/modules/workspace
export type WorkspaceEnv = { kind: "local" } | { kind: "wsl"; distro: string };
export function currentWorkspaceEnv(): WorkspaceEnv {
  return { kind: "local" };
}

// ---- @/modules/ai/store/chatStore (the code block "run in terminal" button)
export const useChatStore = {
  getState: () => ({
    live: {
      injectIntoActivePty(command: string): boolean {
        const leafId = hostState.leafId;
        if (!hostState.leaves.has(leafId)) return false;
        void rpc("host_show_terminal", { leafId });
        return writeToSession(leafId, command);
      },
    },
  }),
};
