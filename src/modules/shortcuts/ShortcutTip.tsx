import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ReactNode } from "react";
import { KbdChip } from "./KbdChip";
import type { ShortcutId } from "./shortcuts";
import { useShortcutText } from "./useShortcutText";

type Props = {
  label: string;
  shortcutId: ShortcutId;
  className?: string;
  /** Suppress the sliding chip entirely. */
  disabled?: boolean;
  /** Hold the chip expanded — e.g. while an anchored popover is open, so
   *  hover changes can't resize the trigger and drag the popover along. */
  pinned?: boolean;
  children: ReactNode;
};

/** On hover, slides the keybinding chip out to the right of the icon. */
export function ShortcutTip({
  label,
  shortcutId,
  className,
  disabled,
  pinned,
  children,
}: Props) {
  const text = useShortcutText(shortcutId);
  const hintsOn = usePreferencesStore((s) => s.hoverKeybindHints);
  const chip = !disabled && hintsOn && text;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards clicks to the inner button, which stays keyboard-accessible
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard access lives on the inner button
    <span
      className={cn(
        "group/tip flex shrink-0 cursor-pointer items-center rounded-md transition-all duration-[calc(250ms*var(--terax-anim,1))] hover:bg-accent [&:hover_button]:text-foreground",
        chip &&
          (pinned
            ? "bg-accent pr-1.5 [&_button]:text-foreground"
            : "hover:pr-1.5"),
        className,
      )}
      // Native tooltip only when there's no sliding chip — otherwise the OS
      // tooltip stacks on top of the revealed keybinding and duplicates it.
      title={chip || disabled ? undefined : label}
      onClick={(e) => {
        // Clicks on the chip area act as clicks on the wrapped button.
        // Clicks on the button itself bubble here too — don't double-fire.
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.querySelector("button")?.click();
      }}
    >
      {children}
      {chip && (
        <span
          className={cn(
            "flex items-center overflow-hidden transition-all duration-[calc(250ms*var(--terax-anim,1))] ease-out",
            pinned
              ? "ml-1 max-w-16 opacity-100"
              : "max-w-0 opacity-0 group-hover/tip:ml-1 group-hover/tip:max-w-16 group-hover/tip:opacity-100",
          )}
        >
          <KbdChip>{text}</KbdChip>
        </span>
      )}
    </span>
  );
}
