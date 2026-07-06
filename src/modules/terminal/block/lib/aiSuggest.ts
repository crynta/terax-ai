// AI layer for the blocks prompt: fish-style command continuations when the
// history has nothing, and one-shot "fix this failed command" requests.
// Reuses the editor autocomplete provider/model preferences wholesale.
//
// Everything heavy is loaded lazily: the terminal is part of the startup
// bundle, and a static import here would drag the whole AI SDK stack into it
// (locked by eager-budget.test.ts).

import type { ShellFixRequest } from "@/modules/editor/lib/autocomplete/provider";

type Impl = {
  deps: typeof import("@/modules/editor/lib/autocomplete/deps");
  provider: typeof import("@/modules/editor/lib/autocomplete/provider");
};

let implPromise: Promise<Impl> | null = null;
function loadImpl(): Promise<Impl> {
  implPromise ??= Promise.all([
    import("@/modules/editor/lib/autocomplete/deps"),
    import("@/modules/editor/lib/autocomplete/provider"),
  ]).then(([deps, provider]) => ({ deps, provider }));
  return implPromise;
}

// The suggest pipelines fire quickly after typing pauses — fine for local
// history, too hot for a network model. Add a settle delay (user-tunable in
// Settings) and drop the request when a newer line supersedes it.
const CACHE_SIZE = 64;

export type AiShellSuggest = {
  /** Up to 3 predicted full command lines — extensions of the typed text,
   *  or corrections of obvious typos. Null when the model passes. */
  suggest: (line: string) => Promise<string[] | null>;
  dispose: () => void;
};

export function createAiShellSuggest(opts: {
  getCwd: () => string | null;
  getRecent: () => readonly string[];
}): AiShellSuggest {
  let apiKey: string | null = null;
  let disposed = false;
  let disposeWatcher: (() => void) | null = null;
  void loadImpl().then(({ deps }) => {
    if (disposed) return;
    const w = deps.createAutocompleteKeyWatcher((k) => {
      apiKey = k;
    });
    disposeWatcher = w.dispose;
  });

  const cache = new Map<string, string[]>();
  let seq = 0;
  let inflight: AbortController | null = null;

  const suggest = async (line: string): Promise<string[] | null> => {
    const { deps, provider } = await loadImpl();
    const prefs = deps.snapshotAutocompletePrefs(apiKey);
    if (!prefs.enabled) return null;
    const minChars = (
      await import("@/modules/settings/preferences")
    ).usePreferencesStore.getState().terminalSuggestMinChars;
    if (line.trim().length < minChars || line.includes("\n")) return null;

    const cwd = opts.getCwd();
    const cacheKey = `${cwd ?? ""}\0${line}`;
    const hit = cache.get(cacheKey);
    if (hit !== undefined) return hit.length > 0 ? hit : null;

    const mySeq = ++seq;
    const settle = (
      await import("@/modules/settings/preferences")
    ).usePreferencesStore.getState().terminalSuggestAiDelayMs;
    await new Promise((r) => setTimeout(r, settle));
    if (mySeq !== seq || disposed) return null; // superseded by newer input

    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      const cands = await provider.requestShellSuggestion(
        { line, cwd, recent: opts.getRecent() },
        prefs,
        ctrl.signal,
      );
      if (mySeq !== seq) return null;
      const clean = cands.filter((c) => c.trim() !== line.trim());
      cache.set(cacheKey, clean);
      if (cache.size > CACHE_SIZE) {
        const first = cache.keys().next().value;
        if (first !== undefined) cache.delete(first);
      }
      return clean.length > 0 ? clean : null;
    } catch (e) {
      // Aborts are routine; real provider errors must be visible somewhere,
      // or "autocomplete is silent" is undebuggable.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        console.warn("terminal ai suggest failed:", e);
      }
      return null;
    } finally {
      if (inflight === ctrl) inflight = null;
    }
  };

  return {
    suggest,
    dispose: () => {
      disposed = true;
      disposeWatcher?.();
      inflight?.abort();
    },
  };
}

/** One-shot fix for a failed block; null when disabled or nothing usable. */
export async function fixFailedCommand(
  req: ShellFixRequest,
): Promise<string | null> {
  const { deps, provider } = await loadImpl();
  const prefs = deps.snapshotAutocompletePrefs(
    await deps.resolveAutocompleteApiKey(),
  );
  if (!prefs.enabled) {
    throw new Error("Enable AI autocomplete in Settings → Models first.");
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const fixed = await provider.requestCommandFix(req, prefs, ctrl.signal);
    return fixed && fixed !== req.command ? fixed : null;
  } finally {
    clearTimeout(timeout);
  }
}
