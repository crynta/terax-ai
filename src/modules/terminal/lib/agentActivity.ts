import { listen } from "@tauri-apps/api/event";

type AgentSignal = { id: number; kind: string };

const active = new Set<number>();
let onExited: ((ptyId: number) => void) | null = null;
let bound = false;

// Covers shells without an OSC 133 C preexec hook (pwsh): the Rust detector
// arms via the Claude Code OSC 777 marker and reports per-pty lifecycle.
export function ensureAgentActivityListener(
  exited: (ptyId: number) => void,
): void {
  onExited = exited;
  if (bound || typeof window === "undefined") return;
  bound = true;
  void listen<AgentSignal>("terax:agent-signal", (e) => {
    if (e.payload.kind === "started") {
      active.add(e.payload.id);
    } else if (e.payload.kind === "exited") {
      active.delete(e.payload.id);
      onExited?.(e.payload.id);
    }
  });
}

export function isAgentActivePty(ptyId: number): boolean {
  return active.has(ptyId);
}
