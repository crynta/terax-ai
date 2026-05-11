import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Mic01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

const MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { id: "gpt-5", label: "GPT-5" },
];

type Props = {
  aiOpen: boolean;
  canSubmit: boolean;
  onOpenAi: () => void;
  onSubmit: () => void;
};

export function AiTools({ aiOpen, canSubmit, onOpenAi, onSubmit }: Props) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {aiOpen ? (
        <motion.div
          key="tools"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="flex items-center gap-0.5"
        >
          <ModelSelector />
          <ToolButton title="Voice input">
            <HugeiconsIcon icon={Mic01Icon} size={14} strokeWidth={1.75} />
          </ToolButton>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={onSubmit}
            className="ml-1 h-6 px-1.5"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={13} strokeWidth={2} />
          </Button>
        </motion.div>
      ) : (
        <motion.button
          key="open"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          onClick={onOpenAi}
          className="flex h-7 items-center gap-2 rounded-md border border-border/60 bg-card px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Open AI Agent
          <KbdGroup>
            <Kbd className="h-4.5 min-w-4.5 px-1 font-mono">
              {fmtShortcut(MOD_KEY, "I")}
            </Kbd>
          </KbdGroup>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function ToolButton({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      className="size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </Button>
  );
}

function ModelSelector() {
  const [selected, setSelected] = useState(MODELS[0]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {selected.label}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={12}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => setSelected(m)}
            className="text-xs"
          >
            {m.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
