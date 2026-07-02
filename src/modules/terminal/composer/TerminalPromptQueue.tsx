import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTerminalComposerStore } from "./terminalComposerStore";

type Props = {
  leafId: number;
  onSend: (text: string) => boolean;
};

export function TerminalPromptQueue({ leafId, onSend }: Props) {
  const queued = useTerminalComposerStore(
    (state) => state.queues[leafId] ?? [],
  );
  const dequeueById = useTerminalComposerStore((state) => state.dequeueById);

  if (queued.length === 0) return null;

  const sendById = (id: string) => {
    const item = queued.find((entry) => entry.id === id);
    if (item && onSend(item.text)) dequeueById(leafId, id);
  };
  const sendNext = () => {
    const item = queued[0];
    if (item && onSend(item.text)) dequeueById(leafId, item.id);
  };

  return (
    <div className="flex min-h-9 items-center gap-1.5 border-t border-border/60 bg-card/65 px-3 py-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
        onClick={sendNext}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
        Queue
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {queued.map((item, index) => (
          <button
            key={item.id}
            type="button"
            title={item.text}
            onClick={() => sendById(item.id)}
            className={cn(
              "flex h-6 max-w-64 shrink-0 items-center gap-1 rounded border border-border/55",
              "bg-background/65 px-2 text-left text-[11px] text-muted-foreground",
              "transition-colors hover:border-border hover:bg-accent hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={TerminalIcon} size={11} strokeWidth={2} />
            <span className="truncate">
              {index + 1}. {previewText(item.text)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function previewText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
