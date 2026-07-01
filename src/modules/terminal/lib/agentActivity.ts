import { listen } from "@tauri-apps/api/event";

type AgentSignal = { id: number; kind: string; agent?: string | null };

const active = new Map<number, string>();
const listeners = new Set<() => void>();
let onExited: ((ptyId: number) => void) | null = null;
let bound = false;

// Covers shells without an OSC 133 C preexec hook (pwsh): Rust detector
// arms via Claude Code OSC 777 marker and reports per-pty lifecycle.
export function ensureAgentActivityListener(exited: (ptyId: number) => void) {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  listen<AgentSignal>("terax:agent-signal", (e) => {
    if (e.payload.kind === "started") {
      active.set(e.payload.id, e.payload.agent ?? "");
      notify();
    }
    if (e.payload.kind === "exited") {
      active.delete(e.payload.id);
      notify();
      onExited?.(e.payload.id);
    }
  });
}

export function isAgentActivePty(ptyId: number): boolean {
  return active.has(ptyId);
}

export function activeAgentForPty(ptyId: number): string | null {
  return active.get(ptyId) ?? null;
}

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}
