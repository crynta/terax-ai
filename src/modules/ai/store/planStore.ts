import { create } from "zustand";
import { native } from "../lib/native";
import { checkWritableCanonical } from "../lib/security";

export type QueuedEdit = {
  id: string;
  /** Tool that produced the queued mutation. */
  kind: "write_file" | "edit" | "multi_edit" | "create_directory";
  path: string;
  /** Original file content (empty for new files / create_directory). */
  originalContent: string;
  /** Proposed full content after edit (empty for create_directory). */
  proposedContent: string;
  /** True if the file did not exist when the edit was queued. */
  isNewFile: boolean;
  /** Human-readable description, used for create_directory. */
  description?: string;
};

type PlanState = {
  active: boolean;
  queue: QueuedEdit[];
  toggle: () => void;
  enable: () => void;
  disable: () => void;
  enqueue: (q: QueuedEdit) => void;
  removeOne: (id: string) => void;
  clear: () => void;
  /** Apply queued edits in order. Returns per-edit results. */
  applyAll: () => Promise<{ id: string; ok: boolean; error?: string }[]>;
};

let nextId = 1;
export function newQueuedEditId(): string {
  return `q-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  active: false,
  queue: [],
  toggle: () =>
    set((s) => ({ active: !s.active, queue: s.active ? [] : s.queue })),
  enable: () => set({ active: true }),
  disable: () => set({ active: false, queue: [] }),
  enqueue: (q) => set((s) => ({ queue: [...s.queue, q] })),
  removeOne: (id) =>
    set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
  clear: () => set({ queue: [] }),
  async applyAll() {
    const items = get().queue;
    const processed = new Set(items.map((q) => q.id));
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const q of items) {
      try {
        // Re-check the deny-list at the mutation boundary: the queue may hold
        // edits approved long before the write lands.
        const safety = await checkWritableCanonical(q.path, native.canonicalize);
        if (!safety.ok) {
          results.push({ id: q.id, ok: false, error: safety.reason });
          continue;
        }
        if (q.kind === "create_directory") {
          await native.createDir(safety.canonical);
        } else {
          await native.writeFile(safety.canonical, q.proposedContent);
        }
        results.push({ id: q.id, ok: true });
      } catch (e) {
        results.push({ id: q.id, ok: false, error: String(e) });
      }
    }
    // Only drain what was processed; edits queued while I/O was pending stay
    // queued for the next application.
    set({ queue: get().queue.filter((q) => !processed.has(q.id)) });
    return results;
  },
}));
