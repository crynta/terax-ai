import { Input } from "@/components/ui/input";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

const DECORATIONS = {
  matchBackground: "#515c6a",
  activeMatchBackground: "#d18616",
  matchOverviewRuler: "#d18616",
  activeMatchColorOverviewRuler: "#d18616",
};

export type SearchInlineHandle = { focus: () => void };

type Props = { addon: SearchAddon | null };

export const SearchInline = forwardRef<SearchInlineHandle, Props>(
  function SearchInline({ addon }, ref) {
    const [q, setQ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    const find = (forward: boolean) => {
      if (!addon || !q) return;
      const opts = { decorations: DECORATIONS };
      if (forward) addon.findNext(q, opts);
      else addon.findPrevious(q, opts);
    };

    return (
      <div className="relative hidden sm:block">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={q}
          placeholder="Search"
          className="h-7 w-32 bg-muted/60 pr-14 pl-7 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0 md:w-44"
          onChange={(e) => {
            const next = e.target.value;
            setQ(next);
            if (addon && next) {
              addon.findNext(next, {
                incremental: true,
                decorations: DECORATIONS,
              });
            } else {
              addon?.clearDecorations();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              find(!e.shiftKey);
            } else if (e.key === "Escape") {
              e.preventDefault();
              addon?.clearDecorations();
              inputRef.current?.blur();
              setQ("");
            }
          }}
        />
      </div>
    );
  },
);
