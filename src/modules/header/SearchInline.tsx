import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EditorPaneHandle } from "@/modules/editor";
import { ShortcutTip } from "@/modules/shortcuts/ShortcutTip";
import { useShortcutText } from "@/modules/shortcuts/useShortcutText";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  | {
      kind: "git-history";
      handle: { setQuery: (q: string) => void; clearQuery: () => void };
      focus: () => void;
    }
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

    const shortcutText = useShortcutText("search.focus");

    const baseLabel = target?.kind === "git-history" ? "Git search" : "Search";

    const placeholder = baseLabel;

    const expanded = !compact || openInCompact;

    const focus = useCallback(() => {
      if (compact) setOpenInCompact(true);
      inputRef.current?.focus();
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
      } else if (target.kind === "editor") {
        if (forward) target.handle.findNext();
        else target.handle.findPrevious();
      }
      // git-history: the list filters live; Enter has no next/prev semantics.
    };

    return (
      <div
        className="relative h-7 shrink-0 transition-[width] duration-[calc(200ms*var(--terax-anim,1))] ease-out"
        style={{ width: expanded ? 192 : 28 }}
      >
        <div
          className={`absolute inset-0 transition-opacity duration-[calc(150ms*var(--terax-anim,1))] ease-out ${
            expanded ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!expanded}
        >
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            ref={inputRef}
            value={q}
            tabIndex={expanded ? undefined : -1}
            placeholder={placeholder}
            className="h-7 w-full rounded-md border-border/50 bg-muted/40 pr-7 pl-7.5 text-[12.5px]! transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/60 focus-visible:border-ring/50 focus-visible:bg-muted/60 focus-visible:ring-0"
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
          {!q && shortcutText && (
            <kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded border border-border/50 bg-card px-1 py-px font-sans text-[10px] font-medium leading-none text-muted-foreground select-none">
              {shortcutText}
            </kbd>
          )}
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
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          )}
        </div>
        <div
          className={`absolute inset-0 flex items-center justify-end transition-opacity duration-[calc(150ms*var(--terax-anim,1))] ease-out ${
            expanded ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          aria-hidden={expanded}
        >
          <ShortcutTip label={baseLabel} shortcutId="search.focus">
            <Button
              variant="ghost"
              size="icon"
              tabIndex={expanded ? -1 : undefined}
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={focus}
            >
              <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.75} />
            </Button>
          </ShortcutTip>
        </div>
      </div>
    );
  },
);
