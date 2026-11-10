import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

/**
 * Turns the user pinned in a Claude session, keyed by session id, so the
 * Chats panel can list them and jump back to them. Each pin keeps its summary
 * and time, so it lists even when its turn is not loaded.
 */
const STORE_PATH = "terax-pinned-turns.json";
const KEY_PINS = "pins";
/** Pins kept per session; the oldest go first. */
export const PINS_PER_SESSION = 200;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type PinnedTurn = {
  /** The turn's id: its prompt's transcript uuid. */
  id: string;
  summary: string;
  at: string | null;
  pinnedAt: number;
};

export type Pins = Record<string, PinnedTurn[]>;

/** `pins` with `turn` pinned in `sessionId`, or unpinned if it was. */
export function withPinToggled(
  pins: Readonly<Pins>,
  sessionId: string,
  turn: Omit<PinnedTurn, "pinnedAt">,
  now: number,
): Pins {
  const list = pins[sessionId] ?? [];
  const next = list.some((p) => p.id === turn.id)
    ? list.filter((p) => p.id !== turn.id)
    : [...list, { ...turn, pinnedAt: now }].slice(-PINS_PER_SESSION);
  const out = { ...pins };
  if (next.length > 0) out[sessionId] = next;
  else delete out[sessionId];
  return out;
}

/** A session's pins in conversation order (by prompt time, then pin time). */
export function pinsInOrder(list: readonly PinnedTurn[]): PinnedTurn[] {
  return [...list].sort(
    (a, b) =>
      (a.at ?? "").localeCompare(b.at ?? "") || a.pinnedAt - b.pinnedAt,
  );
}

function isPin(value: unknown): value is PinnedTurn {
  const v = value as PinnedTurn;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.id === "string" &&
    typeof v.summary === "string" &&
    (v.at === null || typeof v.at === "string") &&
    typeof v.pinnedAt === "number"
  );
}

type PinsState = {
  pins: Pins;
  toggle: (sessionId: string, turn: Omit<PinnedTurn, "pinnedAt">) => void;
};

export const usePinnedTurns = create<PinsState>((set, get) => ({
  pins: {},
  toggle: (sessionId, turn) => {
    const pins = withPinToggled(get().pins, sessionId, turn, Date.now());
    set({ pins });
    void store
      .set(KEY_PINS, pins)
      .then(() => store.save())
      .catch((error: unknown) =>
        console.warn("[terax] could not save the pinned turns:", error),
      );
  },
}));

const NO_PINS: PinnedTurn[] = [];

/** The pins of `sessionId` (a stable empty list when it has none). */
export function useSessionPins(sessionId: string | null): PinnedTurn[] {
  return usePinnedTurns((s) => (sessionId ? s.pins[sessionId] : undefined)) ?? NO_PINS;
}

let loading: Promise<void> | null = null;

/** Loads the saved pins once; later calls are no-ops. */
export function loadPinnedTurns(): Promise<void> {
  loading ??= store
    .get<Pins>(KEY_PINS)
    .then((saved) => {
      const pins: Pins = {};
      for (const [id, list] of Object.entries(saved ?? {})) {
        if (Array.isArray(list)) {
          const valid = list.filter(isPin);
          if (valid.length > 0) pins[id] = valid;
        }
      }
      // Pins made before the load finished win over the saved ones.
      usePinnedTurns.setState((s) => ({ pins: { ...pins, ...s.pins } }));
    })
    .catch(() => {});
  return loading;
}
