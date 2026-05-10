import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { motion } from "motion/react";
import { useEffect } from "react";

type Props = {
  x: number;
  y: number;
  onAsk: () => void;
  onDismiss: () => void;
};

const W = 110;
const OFFSET = 32;

export function SelectionAskAi({ x, y, onAsk, onDismiss }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const top = Math.max(8, y - OFFSET);
  const left = Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8));

  return (
    <motion.div
      data-selection-ask-ai
      initial={{ opacity: 0, y: 4, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.95 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{ top, left, width: W }}
      className="fixed z-50"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAsk();
        }}
        className="flex h-7 w-full items-center justify-between gap-1.5 rounded-md border border-border/60 bg-card/95 px-2 text-xs shadow-lg backdrop-blur-md hover:border-border hover:bg-accent"
      >
        <span>Ask Terax</span>
        <KbdGroup>
          <Kbd className="h-4 min-w-4 px-1 text-[10px]">{fmtShortcut(MOD_KEY, "L")}</Kbd>
        </KbdGroup>
      </button>
    </motion.div>
  );
}
