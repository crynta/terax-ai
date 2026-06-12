export const IME_DEDUP_WINDOW_MS = 100;

type ImeDedupState = {
  data: string;
  ts: number;
  emitted: boolean;
};

export function createImeDedup(): {
  arm(data: string, now: number): void;
  shouldDrop(write: string, now: number): boolean;
  flushPending(now: number): string | null;
} {
  let state: ImeDedupState | null = null;

  return {
    arm(data, now) {
      if (!data) return;
      state = { data, ts: now, emitted: false };
    },
    shouldDrop(write, now) {
      if (!state) return false;
      if (now - state.ts > IME_DEDUP_WINDOW_MS) {
        state = null;
        return false;
      }
      if (write !== state.data) return false;
      if (!state.emitted) {
        state.emitted = true;
        return false;
      }
      return true;
    },
    flushPending(now) {
      if (!state) return null;
      if (now - state.ts > IME_DEDUP_WINDOW_MS) {
        state = null;
        return null;
      }
      if (state.emitted) return null;
      state.emitted = true;
      return state.data;
    },
  };
}
