import { create } from "zustand";

type ReaderStoreState = {
  /** Panes currently showing the Session Reader instead of the terminal. */
  open: Record<number, true>;
  /** Panes whose Reader shows a past chat (read only) instead of the live session. */
  viewing: Record<number, string>;
  setOpen: (leafId: number, open: boolean) => void;
  toggle: (leafId: number) => void;
  setViewing: (leafId: number, sessionId: string | null) => void;
};

export const useReaderStore = create<ReaderStoreState>((set) => ({
  open: {},
  viewing: {},
  setViewing: (leafId, sessionId) =>
    set((s) => {
      if ((s.viewing[leafId] ?? null) === sessionId) return s;
      const next = { ...s.viewing };
      if (sessionId) next[leafId] = sessionId;
      else delete next[leafId];
      return { viewing: next };
    }),
  setOpen: (leafId, open) =>
    set((s) => {
      if (open === (s.open[leafId] === true)) return s;
      const next = { ...s.open };
      if (open) next[leafId] = true;
      else delete next[leafId];
      return { open: next };
    }),
  toggle: (leafId) =>
    set((s) => {
      const next = { ...s.open };
      if (next[leafId]) delete next[leafId];
      else next[leafId] = true;
      return { open: next };
    }),
}));

export function toggleReader(leafId: number): void {
  useReaderStore.getState().toggle(leafId);
}

export function openReader(leafId: number): void {
  useReaderStore.getState().setOpen(leafId, true);
}

export function closeReader(leafId: number): void {
  useReaderStore.getState().setOpen(leafId, false);
}

/** Opens `leafId`'s Reader on a past chat, read only; null returns to the live session. */
export function viewPastChat(leafId: number, sessionId: string | null): void {
  const store = useReaderStore.getState();
  store.setViewing(leafId, sessionId);
  if (sessionId) store.setOpen(leafId, true);
}

/**
 * Sent to a Reader's root (`[data-terax-reader]`) to open its prompt search:
 * the app's Cmd+F shortcut takes the key before the Reader sees it.
 */
export const READER_SEARCH_EVENT = "terax:reader-search";
