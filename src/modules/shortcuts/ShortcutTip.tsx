import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { ShortcutId } from "./shortcuts";
import { useShortcutText } from "./useShortcutText";

type Props = {
  label: string;
  shortcutId: ShortcutId;
  className?: string;
  children: ReactNode;
};

/** On hover, slides the keybinding chip out to the right of the icon. */
export function ShortcutTip({ label, shortcutId, className, children }: Props) {
  const text = useShortcutText(shortcutId);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards clicks to the inner button, which stays keyboard-accessible
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard access lives on the inner button
    <span
      className={cn(
        "group/tip flex shrink-0 cursor-pointer items-center rounded-md transition-all duration-[calc(250ms*var(--terax-anim,1))] hover:bg-accent hover:pr-1.5 [&:hover_button]:text-foreground",
        className,
      )}
      title={label}
      onClick={(e) => {
        // Clicks on the chip area act as clicks on the wrapped button.
        // Clicks on the button itself bubble here too — don't double-fire.
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.querySelector("button")?.click();
      }}
    >
      {children}
      {text && (
        <span className="flex max-w-0 items-center overflow-hidden opacity-0 transition-all duration-[calc(250ms*var(--terax-anim,1))] ease-out group-hover/tip:ml-1 group-hover/tip:max-w-16 group-hover/tip:opacity-100">
          <kbd className="rounded border border-border/50 bg-card px-1 py-px font-sans text-[10px] font-medium leading-none whitespace-nowrap text-muted-foreground select-none">
            {text}
          </kbd>
        </span>
      )}
    </span>
  );
}
