import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorPaneHandle } from "@/modules/editor";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { AnimatePresence, motion } from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

const TERM_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};

export type SearchTarget =
  | { kind: "terminal"; addon: SearchAddon; focus: () => void }
  | { kind: "editor"; handle: EditorPaneHandle; focus: () => void }
  | null;

export type SearchInlineHandle = { focus: () => void };

type Props = {
  target: SearchTarget;
  /** When true, collapse to an icon-only button until the user opens it. */
  compact?: boolean;
};

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target, compact }, ref) {
    const [q, setQ] = useState("");
    // In compact mode the field is hidden behind an icon until activated.
    // In normal mode the field is always present.
    const [openInCompact, setOpenInCompact] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingFocusRef = useRef(false);
    const setInputRef = useCallback((el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (!el || !pendingFocusRef.current) return;
      pendingFocusRef.current = false;
      el.focus();
    }, []);

    const userShortcuts = usePreferencesStore((s) => s.shortcuts);

    const shortcutText = useMemo(() => {
      const s = SHORTCUTS.find((s) => s.id === "search.focus");
      if (!s) return "";
      const bindings = userShortcuts["search.focus"] || s.defaultBindings;
      if (!bindings || bindings.length === 0) return "";
      const tokens = getBindingTokens(bindings[0]);
      return tokens.join("");
    }, [userShortcuts]);

    const placeholder = useMemo(() => {
      const base = target?.kind === "editor" ? "Search in file" : "Search";
      return shortcutText ? `${base} (${shortcutText})` : base;
    }, [target?.kind, shortcutText]);

    const tooltipTitle = useMemo(() => {
      return shortcutText ? `Search (${shortcutText})` : "Search";
    }, [shortcutText]);

    const expanded = !compact || openInCompact;

    const focus = useCallback(() => {
      pendingFocusRef.current = true;
      if (compact) setOpenInCompact(true);
      else inputRef.current?.focus();
      if (inputRef.current) pendingFocusRef.current = false;
    }, [compact]);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const clearTarget = useCallback(() => {
      if (!target) return;
      if (target.kind === "terminal") target.addon.clearDecorations();
      else target.handle.clearQuery();
    }, [target]);

    const restoreTargetFocus = useCallback(() => {
      if (!target) return;
      target.focus();
    }, [target]);

    // Target switched (terminal ↔ editor) or removed → drop highlights.
    useEffect(() => clearTarget, [clearTarget]);

    const applyIncremental = (next: string) => {
      if (!target) return;
      if (target.kind === "terminal") {
        if (next) {
          target.addon.findNext(next, {
            incremental: true,
            decorations: TERM_DECORATIONS,
          });
        } else {
          target.addon.clearDecorations();
        }
      } else {
        target.handle.setQuery(next);
      }
    };

    const findDirection = (forward: boolean) => {
      if (!target || !q) return;
      if (target.kind === "terminal") {
        const opts = { decorations: TERM_DECORATIONS };
        if (forward) target.addon.findNext(q, opts);
        else target.addon.findPrevious(q, opts);
      } else {
        if (forward) target.handle.findNext();
        else target.handle.findPrevious();
      }
    };

    return (
      <motion.div
        layout
        initial={false}
        animate={{ width: expanded ? 192 : 28 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}
        className="relative h-7 shrink-0"
      >
        <AnimatePresence initial={false} mode="wait">
          {expanded ? (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="absolute inset-0"
            >
              <HugeiconsIcon
                icon={Search01Icon}
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={setInputRef}
                value={q}
                placeholder={placeholder}
                className="h-7 w-full bg-muted/80 pr-7 pl-7 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0"
                onChange={(e) => {
                  const next = e.target.value;
                  setQ(next);
                  applyIncremental(next);
                }}
                onBlur={() => {
                  if (compact && !q) setOpenInCompact(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    findDirection(!e.shiftKey);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    clearTarget();
                    setQ("");
                    if (compact) {
                      setOpenInCompact(false);
                    }
                    restoreTargetFocus();
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    clearTarget();
                    inputRef.current?.focus();
                  }}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Clear search"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={11}
                    strokeWidth={2}
                  />
                </button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="absolute inset-0 flex items-center justify-end"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={focus}
                title={tooltipTitle}
              >
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={15}
                  strokeWidth={1.75}
                />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  },
);
