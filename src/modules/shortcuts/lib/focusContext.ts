import { isTerminalSurfaceTarget } from "@/modules/terminal/lib/terminalSurfaceTarget";
import { useSyncExternalStore } from "react";

/**
 * Whether a terminal owns the keyboard, for labels. Shortcut hints must show
 * the chord that fires where the user is about to press it: a terminal gives
 * plain Ctrl chords to the shell (see terminalFocusPolicy). A dialog, popover
 * or menu opened from a terminal keeps that context, because its commands run
 * against the terminal beneath it.
 */
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [cmdk-root]';

export function nextTerminalFocus(
  current: boolean,
  target: { readonly inTerminal: boolean; readonly inOverlay: boolean },
): boolean {
  if (target.inTerminal) return true;
  return target.inOverlay ? current : false;
}

let inTerminal = false;
const listeners = new Set<() => void>();

function describeTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return {
    inTerminal: isTerminalSurfaceTarget(target),
    inOverlay: element?.closest(OVERLAY_SELECTOR) != null,
  };
}

const onFocusIn = (event: FocusEvent): void => {
  const next = nextTerminalFocus(inTerminal, describeTarget(event.target));
  if (next === inTerminal) return;
  inTerminal = next;
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    inTerminal = isTerminalSurfaceTarget(document.activeElement);
    document.addEventListener("focusin", onFocusIn, true);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0)
      document.removeEventListener("focusin", onFocusIn, true);
  };
}

/** Reactive: re-renders when focus moves into or out of a terminal. */
export function useInTerminalFocus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => inTerminal,
    () => false,
  );
}

/** For callers that cannot subscribe (toasts): the state right now. */
export function isTerminalFocusedNow(): boolean {
  if (listeners.size > 0) return inTerminal;
  return (
    typeof document !== "undefined" &&
    isTerminalSurfaceTarget(document.activeElement)
  );
}
