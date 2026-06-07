import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";

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
            aria-label="Send AI prompt"
            className="ml-1 h-8 px-2"
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={ArrowUp01Icon}
              strokeWidth={2}
            />
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
          type="button"
          className="flex h-8 items-center gap-2 rounded-md border border-border/60 bg-card px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
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
      aria-label={title}
      title={title}
      className="size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
          aria-label="Select AI model"
          className="h-8 gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {selected.label}
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {MODELS.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => setSelected(m)}
              className="text-xs"
            >
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
