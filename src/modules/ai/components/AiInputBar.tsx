import { Button } from "@/components/ui/button";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function AiInputBarConnect({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
      <div className="flex h-10 items-center justify-between gap-3 rounded-lg px-3 text-xs">
        <span className="text-muted-foreground">
          Connect any AI provider (or use local models) - your key stays in your
          OS keychain.
        </span>
        <Button size="xs" onClick={onAdd}>
          <HugeiconsIcon icon={Key01Icon} />
          Connect provider
        </Button>
      </div>
    </div>
  );
}
