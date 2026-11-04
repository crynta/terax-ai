import { create } from "zustand";
import type { QueuedPrompt } from "./promptQueue";

const NONE: readonly QueuedPrompt[] = [];

type QueueStoreState = {
  /** Each pane's queued prompts, mirrored from its composer. */
  queued: Record<number, readonly QueuedPrompt[]>;
  set: (leafId: number, items: readonly QueuedPrompt[]) => void;
};

/** The composer's queue, readable outside it (the session rail's "Queued" card). */
export const useQueueStore = create<QueueStoreState>((set) => ({
  queued: {},
  set: (leafId, items) =>
    set((s) =>
      s.queued[leafId] === items
        ? s
        : { queued: { ...s.queued, [leafId]: items } },
    ),
}));

export function useQueuedPrompts(leafId: number): readonly QueuedPrompt[] {
  return useQueueStore((s) => s.queued[leafId] ?? NONE);
}
