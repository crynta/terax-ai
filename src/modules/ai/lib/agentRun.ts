/**
 * Unified agent-run status contract (Phase C, Stage 1).
 *
 * Terax has two agent runtimes: the legacy AI-SDK chat (`chatStore`, status
 * `AgentRunStatus`) and the SOTA pi sessions (`PiSessionStatus`). They use
 * different status vocabularies, so any surface that wants to know "is an agent
 * working?" has to special-case one of them. This module defines one normalized
 * `AgentRun` view-model plus a mapper from each runtime, so consumers depend on
 * the contract instead of a specific runtime. When the runtime backing a
 * surface is swapped (Stage 2), the consumer does not change.
 *
 * Status imports are type-only, so this module stays a dependency-light leaf
 * (no runtime cycle with `chatStore`).
 */
import type { AgentRunStatus } from "@/modules/ai/store/chatStore";
import type { PiSessionStatus } from "@/modules/pi/lib/sessions/types";

/** Normalized run phase both runtimes map onto. */
export type AgentRunPhase =
  | "idle"
  | "preparing"
  | "streaming"
  | "awaiting-approval"
  | "error";

export type AgentRunUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AgentRun = {
  phase: AgentRunPhase;
  /** True while the agent is actively working (not idle, not error). */
  busy: boolean;
  /** Last usage snapshot when the runtime tracks it; null otherwise. */
  usage: AgentRunUsage | null;
  /** Current step/sub-status label when available. */
  step: string | null;
  /** Last error message when `phase` is "error". */
  error: string | null;
};

/** A run is "busy" in any phase that is neither idle nor terminal-error. */
export function isAgentBusy(phase: AgentRunPhase): boolean {
  return phase !== "idle" && phase !== "error";
}

/** Map the legacy chat runtime's status onto the unified phase. */
export function chatStatusToPhase(status: AgentRunStatus): AgentRunPhase {
  switch (status) {
    case "idle":
      return "idle";
    case "thinking":
      return "preparing";
    case "streaming":
      return "streaming";
    case "awaiting-approval":
      return "awaiting-approval";
    case "error":
      return "error";
  }
}

/** Map a pi session's status onto the unified phase. */
export function piStatusToPhase(status: PiSessionStatus): AgentRunPhase {
  switch (status) {
    case "idle":
    case "stopped":
      return "idle";
    case "running":
      return "streaming";
    case "error":
      return "error";
  }
}

/**
 * Build an `AgentRun` from the chat runtime. Accepts a structural subset of
 * `AgentMeta` so this module need not import the store at runtime.
 */
export function chatMetaToAgentRun(meta: {
  status: AgentRunStatus;
  step: string | null;
  error: string | null;
  tokens: AgentRunUsage;
}): AgentRun {
  const phase = chatStatusToPhase(meta.status);
  return {
    phase,
    busy: isAgentBusy(phase),
    usage: meta.tokens,
    step: meta.step,
    error: meta.error,
  };
}

/**
 * Build an `AgentRun` from a pi session. Usage/step are not part of the session
 * status today, so they default to null; richer fields can be threaded later
 * without changing the contract.
 */
export function piSessionToAgentRun(session: {
  status: PiSessionStatus;
  error?: string | null;
}): AgentRun {
  const phase = piStatusToPhase(session.status);
  return {
    phase,
    busy: isAgentBusy(phase),
    usage: null,
    step: null,
    error: phase === "error" ? (session.error ?? null) : null,
  };
}
