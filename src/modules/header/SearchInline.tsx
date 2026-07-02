import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_SEP } from "@/lib/platform";
import type { EditorPaneHandle } from "@/modules/editor";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
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
  | {
      kind: "terminal";
      addon: SearchAddon;
      focus: () => void;
      getSelection: () => string | null;
    }
  | { kind: "editor"; handle: EditorPaneHandle; focus: () => void }
  | {
      kind: "git-history";
      handle: { setQuery: (q: string) => void; clearQuery: () => void };
      focus: () => void;
    }
  | null;

export type SearchInlineHandle = {
  focus: () => void;
  /** Reveal the replace row (editor only) and focus the search field. */
  focusReplace: () => void;
};

type Props = {
  target: SearchTarget;
  /** When true, collapse to an icon-only button until the user opens it. */
  compact?: boolean;
};

/** Small square toggle chip used for the editor search modifiers. */
function SearchToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-medium leading-none transition-colors ${
        active
          ? "bg-primary/85 text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target, compact }, ref) {
    const [q, setQ] = useState("");
    const [replaceVal, setReplaceVal] = useState("");
    const [replaceOpen, setReplaceOpen] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [regexp, setRegexp] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
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

    const isEditor = target?.kind === "editor";

    const shortcutText = useMemo(() => {
      const s = SHORTCUTS.find((s) => s.id === "search.focus");
      if (!s) return "";
      const bindings = userShortcuts["search.focus"] || s.defaultBindings;
      if (!bindings || bindings.length === 0) return "";
      const tokens = getBindingTokens(bindings[0]);
      return tokens.join(KEY_SEP);
    }, [userShortcuts]);

    const baseLabel = target?.kind === "git-history" ? "Git search" : "Search";

    const placeholder = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const tooltipTitle = useMemo(() => {
      return shortcutText ? `${baseLabel} (${shortcutText})` : baseLabel;
    }, [baseLabel, shortcutText]);

    const expanded = !compact || openInCompact;

    const focusInput = useCallback(() => {
      pendingFocusRef.current = true;
      if (compact) setOpenInCompact(true);
      else inputRef.current?.focus();
      if (inputRef.current) pendingFocusRef.current = false;
    }, [compact]);

    // Seed the query from the active selection so "select text → Cmd+F/Cmd+H"
    // starts searching that text. Single-line selections only — a multi-line
    // block isn't a sensible search term.
    const prefillFromSelection = useCallback(() => {
      let sel: string | null = null;
      if (target?.kind === "editor") sel = target.handle.getSelection();
      else if (target?.kind === "terminal") sel = target.getSelection();
      if (sel && sel.length > 0 && !sel.includes("\n")) setQ(sel);
    }, [target]);

    const openSearch = useCallback(
      (replace: boolean) => {
        prefillFromSelection();
        if (replace) setReplaceOpen(true);
        focusInput();
      },
      [prefillFromSelection, focusInput],
    );

    const focus = useCallback(() => openSearch(false), [openSearch]);
    const focusReplace = useCallback(() => openSearch(true), [openSearch]);

    useImperativeHandle(ref, () => ({ focus, focusReplace }), [
      focus,
      focusReplace,
    ]);

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

    // Single place that pushes the current query + modifiers into the active
    // target. Editor targets carry the replacement text and modifiers; the
    // terminal keeps its original incremental behaviour untouched.
    useEffect(() => {
      if (!target) return;
      if (target.kind === "terminal") {
        if (q) {
          target.addon.findNext(q, {
            incremental: true,
            decorations: TERM_DECORATIONS,
          });
        } else {
          target.addon.clearDecorations();
        }
      } else if (target.kind === "editor") {
        target.handle.setQuery(q, {
          replace: replaceVal,
          caseSensitive,
          regexp,
          wholeWord,
        });
      } else {
        target.handle.setQuery(q);
      }
    }, [q, replaceVal, caseSensitive, regexp, wholeWord, target]);

    const findDirection = (forward: boolean) => {
      if (!target || !q) return;
      if (target.kind === "terminal") {
        const opts = { decorations: TERM_DECORATIONS };
        if (forward) target.addon.findNext(q, opts);
        else target.addon.findPrevious(q, opts);
      } else if (target.kind === "editor") {
        if (forward) target.handle.findNext();
        else target.handle.findPrevious();
      }
      // git-history: the list filters live; Enter has no next/prev semantics.
    };

    const doReplaceNext = () => {
      if (target?.kind !== "editor" || !q) return;
      // Make sure the latest replacement text is in the query before replacing.
      target.handle.setQuery(q, {
        replace: replaceVal,
        caseSensitive,
        regexp,
        wholeWord,
      });
      target.handle.replaceNext();
    };

    const doReplaceAll = () => {
      if (target?.kind !== "editor" || !q) return;
      target.handle.setQuery(q, {
        replace: replaceVal,
        caseSensitive,
        regexp,
        wholeWord,
      });
      target.handle.replaceAll();
    };

    const dismiss = () => {
      clearTarget();
      setQ("");
      setReplaceOpen(false);
      if (compact) setOpenInCompact(false);
      restoreTargetFocus();
    };

    return (
      <div
        className="relative h-7 shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: expanded ? (isEditor ? 264 : 192) : 28 }}
      >
        {expanded ? (
          <div className="flex h-full items-center gap-1 animate-in fade-in-0 duration-150">
            <div className="relative min-w-0 flex-1">
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
                className="h-7 w-full bg-muted/80 pr-7 pl-7 text-[13px]! placeholder:text-muted-foreground/70 focus-visible:ring-0"
                onChange={(e) => setQ(e.target.value)}
                onBlur={() => {
                  if (compact && !q) setOpenInCompact(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    findDirection(!e.shiftKey);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    dismiss();
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
            </div>

            {isEditor && (
              <div className="flex shrink-0 items-center gap-0.5">
                <SearchToggle
                  active={caseSensitive}
                  onClick={() => setCaseSensitive((v) => !v)}
                  title="Match case"
                >
                  Aa
                </SearchToggle>
                <SearchToggle
                  active={wholeWord}
                  onClick={() => setWholeWord((v) => !v)}
                  title="Match whole word"
                >
                  W
                </SearchToggle>
                <SearchToggle
                  active={regexp}
                  onClick={() => setRegexp((v) => !v)}
                  title="Use regular expression"
                >
                  .*
                </SearchToggle>
                <button
                  type="button"
                  onClick={() => setReplaceOpen((v) => !v)}
                  aria-pressed={replaceOpen}
                  title="Toggle replace"
                  className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                    replaceOpen
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={13}
                    strokeWidth={2}
                    className={`transition-transform ${
                      replaceOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-end animate-in fade-in-0 duration-150">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={focus}
              title={tooltipTitle}
            >
              <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.75} />
            </Button>
          </div>
        )}

        {isEditor && expanded && replaceOpen && (
          <div className="absolute top-[calc(100%+4px)] right-0 z-50 w-[264px] rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95 duration-100">
            <div className="flex items-center gap-1">
              <input
                value={replaceVal}
                placeholder="Replace"
                onChange={(e) => setReplaceVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doReplaceNext();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    dismiss();
                  }
                }}
                className="h-6 min-w-0 flex-1 rounded bg-muted/70 px-2 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <button
                type="button"
                onClick={doReplaceNext}
                title="Replace next match (Enter)"
                className="h-6 shrink-0 rounded px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={doReplaceAll}
                title="Replace all matches"
                className="h-6 shrink-0 rounded px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                All
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);
