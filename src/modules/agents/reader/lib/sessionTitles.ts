import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

/**
 * Names given to Claude sessions inside Terax, keyed by session id. Used when
 * Claude's own `/rename` isn't available, and shown in the Reader header, the
 * Agents sidebar and the chat history.
 */
const STORE_PATH = "terax-session-titles.json";
const KEY_TITLES = "titles";
export const SESSION_TITLE_MAX = 80;

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

/** A cleaned title: one line, trimmed, capped; null when nothing is left. */
export function normalizeSessionTitle(raw: string): string | null {
  const one = raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!one) return null;
  return one.length > SESSION_TITLE_MAX
    ? one.slice(0, SESSION_TITLE_MAX).trimEnd()
    : one;
}

/** `titles` with `sessionId` renamed to `title`, or the name removed for null. */
export function withSessionTitle(
  titles: Readonly<Record<string, string>>,
  sessionId: string,
  title: string | null,
): Record<string, string> {
  const next = { ...titles };
  const clean = title === null ? null : normalizeSessionTitle(title);
  if (clean) next[sessionId] = clean;
  else delete next[sessionId];
  return next;
}

type TitlesState = {
  titles: Record<string, string>;
  loaded: boolean;
  setTitle: (sessionId: string, title: string | null) => void;
};

export const useSessionTitles = create<TitlesState>((set, get) => ({
  titles: {},
  loaded: false,
  setTitle: (sessionId, title) => {
    const titles = withSessionTitle(get().titles, sessionId, title);
    set({ titles });
    void store
      .set(KEY_TITLES, titles)
      .then(() => store.save())
      .catch((error: unknown) =>
        console.warn("[terax] could not save the session name:", error),
      );
  },
}));

let loading: Promise<void> | null = null;

/** Loads the saved names once; later calls are no-ops. */
export function loadSessionTitles(): Promise<void> {
  loading ??= store
    .get<Record<string, string>>(KEY_TITLES)
    .then((saved) => {
      const titles: Record<string, string> = {};
      for (const [id, name] of Object.entries(saved ?? {})) {
        const clean =
          typeof name === "string" ? normalizeSessionTitle(name) : null;
        if (clean) titles[id] = clean;
      }
      useSessionTitles.setState((s) => ({
        // Names set before the load finished win over the saved ones.
        titles: { ...titles, ...s.titles },
        loaded: true,
      }));
    })
    .catch(() => {
      useSessionTitles.setState({ loaded: true });
    });
  return loading;
}

/** The Terax name of `sessionId`, or null. Loads the saved names on first use. */
export function useSessionTitle(sessionId: string | null): string | null {
  const title = useSessionTitles((s) =>
    sessionId ? (s.titles[sessionId] ?? null) : null,
  );
  if (!useSessionTitles.getState().loaded) void loadSessionTitles();
  return title;
}
