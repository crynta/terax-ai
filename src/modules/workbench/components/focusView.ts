import {
  currentFocus,
  focusIsMovable,
} from "@/modules/terminal/lib/focusGuard";

/** Lazy views take over from the slot, but leave user focus elsewhere alone. */
export function focusView(slot: HTMLElement, handle?: { focus(): void }) {
  const active = currentFocus();
  if (
    (active !== slot && slot.contains(active as Node | null)) ||
    !focusIsMovable(active)
  )
    return;
  if (handle) handle.focus();
  else slot.focus({ preventScroll: true });
}
