import { create } from "zustand";

export type QueuedTerminalPrompt = {
  id: string;
  text: string;
};

type TerminalComposerState = {
  drafts: Record<number, string>;
  queues: Record<number, QueuedTerminalPrompt[]>;
  setDraft: (leafId: number, text: string) => void;
  draftFor: (leafId: number) => string;
  consumeDraft: (leafId: number) => string | null;
  enqueueDraft: (leafId: number) => QueuedTerminalPrompt | null;
  queuedFor: (leafId: number) => QueuedTerminalPrompt[];
  dequeueNext: (leafId: number) => QueuedTerminalPrompt | null;
  dequeueById: (leafId: number, id: string) => QueuedTerminalPrompt | null;
  reset: () => void;
};

let nextQueueId = 1;

function newQueueId(): string {
  return `terminal-composer-${nextQueueId++}`;
}

function initialState() {
  return {
    drafts: {},
    queues: {},
  };
}

export const useTerminalComposerStore = create<TerminalComposerState>(
  (set, get) => ({
    ...initialState(),
    setDraft: (leafId, text) =>
      set((state) => ({ drafts: { ...state.drafts, [leafId]: text } })),
    draftFor: (leafId) => get().drafts[leafId] ?? "",
    consumeDraft: (leafId) => {
      const text = get().draftFor(leafId);
      if (!text.trim()) return null;
      set((state) => ({ drafts: { ...state.drafts, [leafId]: "" } }));
      return text;
    },
    enqueueDraft: (leafId) => {
      const text = get().draftFor(leafId);
      if (!text.trim()) return null;
      const item = { id: newQueueId(), text };
      set((state) => ({
        drafts: { ...state.drafts, [leafId]: "" },
        queues: {
          ...state.queues,
          [leafId]: [...(state.queues[leafId] ?? []), item],
        },
      }));
      return item;
    },
    queuedFor: (leafId) => get().queues[leafId] ?? [],
    dequeueNext: (leafId) => {
      const queue = get().queues[leafId] ?? [];
      const [next, ...rest] = queue;
      if (!next) return null;
      set((state) => ({ queues: { ...state.queues, [leafId]: rest } }));
      return next;
    },
    dequeueById: (leafId, id) => {
      const queue = get().queues[leafId] ?? [];
      const item = queue.find((entry) => entry.id === id);
      if (!item) return null;
      set((state) => ({
        queues: {
          ...state.queues,
          [leafId]: (state.queues[leafId] ?? []).filter(
            (entry) => entry.id !== id,
          ),
        },
      }));
      return item;
    },
    reset: () => {
      nextQueueId = 1;
      set(initialState());
    },
  }),
);
