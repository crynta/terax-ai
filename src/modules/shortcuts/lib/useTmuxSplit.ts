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
};

/** How long after the prefix we wait for the second stroke before resetting. */
const PREFIX_TIMEOUT_MS = 1500;

/**
 * Two-stroke tmux prefix-sequence handler for pane splitting. This is
 * deliberately separate machinery from the single-chord `useGlobalShortcuts`:
 * the user presses the prefix (e.g. Ctrl+A), releases, then presses the split
 * key (e.g. `\` for split right or `-` for split down) — bindings read from
 * their own `~/.tmux.conf` by the backend.
 *
 * `onSplit("row")` = split right; `onSplit("col")` = split down.
 */
export function useTmuxSplit(onSplit: (dir: "row" | "col") => void): void {
  // null = "auto" → follow the backend's `enabled` (whether a tmux config was
  // found). true/false = explicit user override.
  const tmuxSplitKeys = usePreferencesStore((s) => s.tmuxSplitKeys);

  const bindingsRef = useRef<TmuxSplitBindings | null>(null);
  const onSplitRef = useRef(onSplit);
  onSplitRef.current = onSplit;

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
        // Second stroke of the sequence.
        if (e.key === b.splitRight) {
          onSplitRef.current("row");
          clearPending();
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === b.splitDown) {
          onSplitRef.current("col");
          clearPending();
          e.preventDefault();
          e.stopPropagation();
        } else {
          // Not a split key — abandon the sequence and let the key through.
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
