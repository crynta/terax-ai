import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_SEP } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  formatSearchCount,
  type SearchMatchStatus,
  searchMissed,
} from "./lib/searchCount";

const TERM_DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};

export type SearchTarget =
  | { kind: "terminal"; addon: TerminalSearchController; focus: () => void }
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

function readMatchStatus(
  target: SearchTarget,
  query: string,
): SearchMatchStatus | null {
  if (!target || !query) return null;
  if (target.kind === "terminal") return target.addon.matchStatus();
  if (target.kind === "editor") return target.handle.matchStatus();
  return null;
}

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ target, compact }, ref) {
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<SearchMatchStatus | null>(null);
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
    const count = formatSearchCount(q, status);
    const missed = searchMissed(q, status);
    const qRef = useRef(q);
    qRef.current = q;

    const refreshStatus = useCallback(
      (query = qRef.current) => {
        setStatus(readMatchStatus(target, query));
      },
      [target],
    );

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

    const applyIncremental = useCallback(
      (next: string) => {
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
      },
      [target],
    );

    useEffect(() => {
      if (!target) {
        setStatus(null);
        return;
      }
      const query = qRef.current;
      if (query) applyIncremental(query);
      else clearTarget();
      refreshStatus(query);
      if (target.kind !== "terminal") return;
      return target.addon.subscribe(() => refreshStatus());
    }, [applyIncremental, clearTarget, refreshStatus, target]);

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
      refreshStatus();
    };

    return (
      <search
        className="relative h-7 shrink-0 transition-[width] duration-200 ease-out"
        style={{ width: expanded ? 220 : 28 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {expanded ? (
          <div className="absolute inset-0 animate-in fade-in-0 duration-150">
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
              aria-invalid={missed || undefined}
              className={cn(
                "h-7 w-full bg-muted/80 pl-7 text-[13px]! placeholder:text-muted-foreground/70 focus-visible:ring-0",
                count ? "pr-14" : "pr-7",
                missed && "text-destructive",
              )}
              onChange={(e) => {
                const next = e.target.value;
                setQ(next);
                applyIncremental(next);
                refreshStatus(next);
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
                  setStatus(null);
                  if (compact) {
                    setOpenInCompact(false);
                  }
                  restoreTargetFocus();
                }
              }}
            />
            {count && (
              <span
                className={cn(
                  "pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 text-[10px] tabular-nums",
                  missed ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setStatus(null);
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
      </search>
    );
  },
);
