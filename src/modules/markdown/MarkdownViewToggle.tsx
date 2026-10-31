import { cn } from "@/lib/utils";
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Mode = "rendered" | "raw";

type Props = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  onReload?: () => void;
  renderedDisabled?: boolean;
  renderedHint?: string;
};

export function MarkdownViewToggle({
  mode,
  onChange,
  onReload,
  renderedDisabled,
  renderedHint,
}: Props) {
  return (
    <div className="absolute right-3 top-3 z-10 inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-card p-0.5 text-[11px] shadow-sm">
      {onReload && (
        <>
          <button
            type="button"
            onClick={onReload}
            title="Reload"
            aria-label="Reload"
            className="flex items-center rounded px-1.5 py-[3px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              size={12}
              strokeWidth={1.75}
            />
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-border/60" aria-hidden />
        </>
      )}
      <button
        type="button"
        onClick={() => onChange("rendered")}
        disabled={renderedDisabled}
        title={renderedDisabled ? renderedHint : undefined}
        className={cn(
          "rounded px-2 py-0.5 transition-colors",
          mode === "rendered"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
          renderedDisabled &&
            "cursor-not-allowed opacity-40 hover:text-muted-foreground",
        )}
      >
        Rendered
      </button>
      <button
        type="button"
        onClick={() => onChange("raw")}
        className={cn(
          "rounded px-2 py-0.5 transition-colors",
          mode === "raw"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Raw
      </button>
    </div>
  );
}
