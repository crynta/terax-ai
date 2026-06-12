const IME_DEDUP_WINDOW_MS = 100;

type ImeDedupState = {
  data: string;
  ts: number;
};

export function createImeDedup(): {
  arm(data: string, now: number): void;
  shouldDrop(write: string, now: number): boolean;
} {
  let state: ImeDedupState | null = null;

  return {
    arm(data, now) {
      if (!data) return;
      state = { data, ts: now };
    },
    shouldDrop(write, now) {
      if (!state) return false;
      if (now - state.ts > IME_DEDUP_WINDOW_MS) {
        state = null;
        return false;
      }
      if (write !== state.data) return false;
      state = null;
      return true;
    },
  };
}
