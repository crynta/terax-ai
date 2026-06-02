import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SearchModifiers } from "./lib/types";

type Props = {
  onSearch: (pattern: string, modifiers: SearchModifiers) => void;
  loading: boolean;
};

const DEBOUNCE_MS = 200;

type ToggleDef = {
  key: keyof SearchModifiers;
  label: string;
};

const TOGGLES: ToggleDef[] = [
  { key: "caseSensitive", label: "Aa" },
  { key: "regex", label: ".*" },
  { key: "wholeWord", label: "W" },
];

export function SearchInput({ onSearch, loading }: Props) {
  const [pattern, setPattern] = useState("");
  const [modifiers, setModifiers] = useState<SearchModifiers>({
    caseSensitive: false,
    regex: false,
    wholeWord: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef(0);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSearch(pattern, modifiers);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [pattern, modifiers, onSearch]);

  const toggleModifier = useCallback((key: keyof SearchModifiers) => {
    setModifiers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setPattern("");
        inputRef.current?.blur();
      }
    },
    [],
  );

  return (
    <div className="border-b border-border/60">
      <div className="relative flex items-center px-3 pt-3">
        <input
          ref={inputRef}
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search in workspace..."
          className={cn(
            "h-8 w-full rounded-md border border-border/60 bg-background px-2.5 pr-8 text-sm outline-none",
            "placeholder:text-muted-foreground/50",
            "focus:border-primary/40 focus:ring-1 focus:ring-primary/20",
            "transition-colors duration-150",
          )}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        )}
      </div>

      <div className="flex gap-1 px-3 pb-2 pt-1.5">
        {TOGGLES.map((t) => {
          const active = modifiers[t.key];
          return (
            <button
              key={t.key}
              type="button"
              aria-label={t.key}
              aria-pressed={active}
              onClick={() => toggleModifier(t.key)}
              className={cn(
                "flex h-6 cursor-pointer items-center rounded px-1.5 text-[11px] font-medium tracking-wide outline-none transition-colors duration-150",
                "focus-visible:ring-2 focus-visible:ring-primary/40",
                active
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
