import { Button } from "@/components/ui/button";
import { Cancel01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";

export function AiInputBarConnect({
  onAdd,
  onClose,
}: {
  onAdd: () => void;
  onClose?: () => void;
}) {
  // Esc dismisses the stuck connect-provider banner (#304). Without this
  // (and the dismiss button), panelOpen + !hasComposer left no way to hide it -
  // StatusBar only shows panel-close controls when hasComposer is true.
  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="shrink-0 border-t border-border/60 bg-foreground/[0.02] px-3 py-2">
      <div className="flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs">
        <span className="text-muted-foreground">
          Connect any AI provider (or use local models) - your key stays in your
          OS keychain.
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="xs" onClick={onAdd}>
            <HugeiconsIcon icon={Key01Icon} />
            Connect provider
          </Button>
          {onClose ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="size-7"
              aria-label="Close"
              title="Close (Esc)"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
