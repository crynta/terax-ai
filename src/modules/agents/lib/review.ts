import { getOrCreateChat, useChatStore } from "@/modules/ai/store/chatStore";
import {
  type ManagedAgent,
  useManagedAgentsStore,
} from "../store/managedAgentsStore";

function buildReviewDirective(m: ManagedAgent): string {
  const remaining = m.maxRounds - m.rounds;
  const lastRound =
    remaining <= 1
      ? " This is the last automatic review round, so make any follow-up count."
      : "";
  return `The Claude Code agent you are supervising has finished its turn on:

> ${m.task}

Call read_agent_output to see what it actually did and reported. Then decide: if the task is complete, confirm it is done (do not call send_to_agent); otherwise call send_to_agent with one precise follow-up.${lastRound}`;
}

function canReview(m: ManagedAgent): boolean {
  if (m.phase === "done") return false;
  if (m.rounds >= m.maxRounds) return false;
  if (m.reviewedAtRound >= m.rounds) return false;
  return true;
}

function fireReview(m: ManagedAgent): void {
  const store = useManagedAgentsStore.getState();
  store.markReviewed(m.leafId);
  store.setPhase(m.leafId, "reviewing");
  const chat = getOrCreateChat(m.sessionId);
  void chat.sendMessage({
    role: "user",
    parts: [{ type: "text", text: buildReviewDirective(m) }],
  } as Parameters<typeof chat.sendMessage>[0]);
}

export function maybeTriggerManagedReview(leafId: number): void {
  const store = useManagedAgentsStore.getState();
  const m = store.get(leafId);
  if (!m || !canReview(m)) return;
  if (useChatStore.getState().activeSessionId !== m.sessionId) {
    store.setPendingReview(leafId, true);
    return;
  }
  fireReview(m);
}

export function firePendingReviewForSession(sessionId: string): void {
  const store = useManagedAgentsStore.getState();
  const m = store.getBySessionId(sessionId);
  if (!m?.pendingReview) return;
  if (!canReview(m)) {
    store.setPendingReview(m.leafId, false);
    return;
  }
  fireReview(m);
}
