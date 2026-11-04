/**
 * Messages written while Claude works wait here and go out one at a time once
 * it is idle. Pure state transitions; the composer keeps one queue per pane.
 */

import type { AgentPhase } from "@/modules/terminal/lib/agentActivity";
import type { Mention } from "./mentions";

export type QueuedPrompt = {
  id: string;
  text: string;
  mentions: Mention[];
  /** Saved image paths. */
  images: string[];
  /** Queued while Claude showed a question: waits for the answer. */
  afterDialog?: boolean;
};

export type PromptQueue = {
  items: QueuedPrompt[];
  /** The item just sent and when, until Claude is seen working on it. */
  inFlight: { id: string; at: number } | null;
  /** Held after a manual Stop, so queued messages don't fire straight away. */
  paused?: boolean;
};

export const EMPTY_QUEUE: PromptQueue = { items: [], inFlight: null };

export function pauseQueue(q: PromptQueue): PromptQueue {
  return q.paused ? q : { ...q, paused: true };
}

export function resumeQueue(q: PromptQueue): PromptQueue {
  return q.paused ? { ...q, paused: false } : q;
}

export type SendDecision = "send" | "queue" | "queueAfterDialog";

/**
 * What Enter does with a message. A question on screen always queues it:
 * typed text would land on Claude's menu and Enter would pick an answer.
 * While Claude works it queues unless `steer` (Cmd+Enter) sends it now.
 */
export function sendDecision(s: {
  working: boolean;
  dialog: boolean;
  steer: boolean;
}): SendDecision {
  if (s.dialog) return "queueAfterDialog";
  if (s.working && !s.steer) return "queue";
  return "send";
}

/** Claude must look idle this long before the next queued message goes. */
export const QUEUE_SETTLE_MS = 900;
/** An in-flight send that never started work is forgotten after this. */
export const QUEUE_IN_FLIGHT_MS = 8_000;

export function enqueue(q: PromptQueue, item: QueuedPrompt): PromptQueue {
  return { ...q, items: [...q.items, item] };
}

export function removeQueued(q: PromptQueue, id: string): PromptQueue {
  return { ...q, items: q.items.filter((i) => i.id !== id) };
}

export function editQueued(
  q: PromptQueue,
  id: string,
  text: string,
): PromptQueue {
  return {
    ...q,
    items: q.items.map((i) => (i.id === id ? { ...i, text } : i)),
  };
}

/** Moves item `id` by `delta` places, clamped to the ends. */
export function moveQueued(
  q: PromptQueue,
  id: string,
  delta: number,
): PromptQueue {
  const from = q.items.findIndex((i) => i.id === id);
  if (from < 0) return q;
  const to = Math.max(0, Math.min(q.items.length - 1, from + delta));
  if (to === from) return q;
  const items = [...q.items];
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  return { ...q, items };
}

export type IdleSignals = {
  phase: AgentPhase | undefined;
  /** A permission or choice dialog is on screen. */
  dialog: boolean;
  /** Claude's spinner line says it is still working. */
  activityWorking: boolean;
  /** When the signals above last turned idle, or null while busy. */
  idleSince: number | null;
  now: number;
};

/** Whether Claude is idle for long enough that a queued message can go. */
export function isSettled(s: IdleSignals, settleMs = QUEUE_SETTLE_MS): boolean {
  return (
    s.phase !== "working" &&
    !s.dialog &&
    !s.activityWorking &&
    s.idleSince !== null &&
    s.now - s.idleSince >= settleMs
  );
}

/** Whether the next queued message should be sent now. */
export function readyToSend(q: PromptQueue, s: IdleSignals): boolean {
  if (q.items.length === 0 || q.paused) return false;
  if (q.inFlight && s.now - q.inFlight.at < QUEUE_IN_FLIGHT_MS) return false;
  return isSettled(s);
}

/** Takes the first item for sending and marks it in flight. */
export function takeNext(
  q: PromptQueue,
  now: number,
): { queue: PromptQueue; item: QueuedPrompt | null } {
  const [item, ...rest] = q.items;
  if (!item) return { queue: q, item: null };
  return { queue: { items: rest, inFlight: { id: item.id, at: now } }, item };
}

/** Clears the in-flight mark once Claude has started working on it. */
export function settleInFlight(
  q: PromptQueue,
  phase: AgentPhase | undefined,
): PromptQueue {
  return q.inFlight && phase === "working" ? { ...q, inFlight: null } : q;
}
