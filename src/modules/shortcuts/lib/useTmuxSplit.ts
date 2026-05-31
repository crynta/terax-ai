import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";

/** Mirror of the Rust `PrefixKey` (serde camelCase). */
type PrefixKey = { ctrl: boolean; key: string };

/** Mirror of the Rust `TmuxSplitBindings` (serde camelCase). */
type TmuxSplitBindings = {
  enabled: boolean;
  prefix: PrefixKey;
  splitRight: string;
  splitDown: string;
  focusLeft: string;
  focusRight: string;
  focusUp: string;
  focusDown: string;
};

export type TmuxFocusDir = "left" | "right" | "up" | "down";

/** How long after the prefix we wait for the second stroke before resetting. */
const PREFIX_TIMEOUT_MS = 1500;

/** tmux arrow tokens → JS `KeyboardEvent.key` names. */
const ARROW_KEYS: Record<string, string> = {
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

/** Does a keydown's `key` match a tmux key token (case-insensitive, arrows normalized)? */
function keyMatches(eventKey: string, token: string): boolean {
  const norm = ARROW_KEYS[token] ?? token;
  return (
    eventKey === norm || eventKey.toLowerCase() === norm.toLowerCase()
  );
}

/**
 * Two-stroke tmux prefix-sequence handler. Deliberately separate machinery
 * from the single-chord `useGlobalShortcuts`: the user presses the prefix
 * (e.g. Ctrl+A), releases, then presses a second key read from their own
 * `~/.tmux.conf`:
 *   - split keys (`\` / `-`) → `onSplit("row")` (right) / `onSplit("col")` (down)
 *   - select-pane keys (`h`/`j`/`k`/`l` or arrows) → `onFocus("left"|...)`
 *
 * Pane focus is directional in intent; the app only supports next/prev pane
 * cycling, so the caller maps left/up → previous, right/down → next.
 */
export function useTmuxSplit(
  onSplit: (dir: "row" | "col") => void,
  onFocus?: (dir: TmuxFocusDir) => void,
): void {
  // null = "auto" → follow the backend's `enabled` (whether a tmux config was
  // found). true/false = explicit user override.
  const tmuxSplitKeys = usePreferencesStore((s) => s.tmuxSplitKeys);

  const bindingsRef = useRef<TmuxSplitBindings | null>(null);
  const onSplitRef = useRef(onSplit);
  onSplitRef.current = onSplit;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  // Fetch the bindings once on mount.
  useEffect(() => {
    let cancelled = false;
    void invoke<TmuxSplitBindings>("tmux_split_bindings")
      .then((b) => {
        if (!cancelled) bindingsRef.current = b;
      })
      .catch(() => {
        /* ignore — handler simply stays inert without bindings */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pending = { active: false };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearPending = () => {
      pending.active = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const b = bindingsRef.current;
      if (!b) return;
      // Resolve "auto" (null) against the backend's `enabled`.
      const enabled = tmuxSplitKeys ?? b.enabled;
      if (!enabled) return;

      if (pending.active) {
        // Second stroke of the sequence: split, then pane-focus.
        const consume = () => {
          clearPending();
          e.preventDefault();
          e.stopPropagation();
        };
        if (keyMatches(e.key, b.splitRight)) {
          onSplitRef.current("row");
          consume();
        } else if (keyMatches(e.key, b.splitDown)) {
          onSplitRef.current("col");
          consume();
        } else if (keyMatches(e.key, b.focusLeft)) {
          onFocusRef.current?.("left");
          consume();
        } else if (keyMatches(e.key, b.focusRight)) {
          onFocusRef.current?.("right");
          consume();
        } else if (keyMatches(e.key, b.focusUp)) {
          onFocusRef.current?.("up");
          consume();
        } else if (keyMatches(e.key, b.focusDown)) {
          onFocusRef.current?.("down");
          consume();
        } else {
          // Not a bound key — abandon the sequence and let the key through.
          clearPending();
        }
        return;
      }

      // First stroke: the prefix (e.g. Ctrl+A) with no other modifiers.
      const isPrefix =
        b.prefix.ctrl &&
        e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === b.prefix.key;
      if (isPrefix) {
        pending.active = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(clearPending, PREFIX_TIMEOUT_MS);
        // Swallow the prefix so the terminal never receives it.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      clearPending();
    };
  }, [tmuxSplitKeys]);
}
