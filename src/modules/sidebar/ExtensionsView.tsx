import { PuzzleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function ExtensionsView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border/60 px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Extensions
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-muted-foreground">
          <HugeiconsIcon icon={PuzzleIcon} size={20} strokeWidth={1.6} />
        </div>
        <div className="text-sm font-medium">Extensions</div>
        <div className="max-w-56 text-[11px] leading-relaxed text-muted-foreground">
          Coming soon — install themes, snippets and integrations from the Terax
          gallery.
        </div>
      </div>
    </div>
  );
}
