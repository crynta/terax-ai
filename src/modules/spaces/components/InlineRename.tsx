import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

type Props = {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
};

export function InlineRename({
  initial,
  onCommit,
  onCancel,
  className,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename space"
      className={cn(
        "w-full min-w-0 rounded-sm bg-background px-1.5 py-0.5 text-xs text-foreground outline-none ring-1 ring-border focus:ring-ring",
        className,
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(() => onCommit(e.currentTarget.value));
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        if (!document.hasFocus()) return;
        finish(() => onCommit(e.currentTarget.value));
      }}
    />
  );
}
