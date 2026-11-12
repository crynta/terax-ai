import { remeasureTerminalWindows } from "@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime";
import {
  subscribeTerminalResizeInteraction,
  terminalResizeInteractionActive,
} from "@/modules/terminal/lib/terminalResizeInteraction";

let waiting = false;

/**
 * A terminal card moved without necessarily resizing: re-read pane rectangles.
 * During a resize gesture every frame moves something, so the read waits for
 * the gesture to end and happens once.
 */
export function requestTerminalRemeasure(
  remeasure: () => void = remeasureTerminalWindows,
): void {
  if (!terminalResizeInteractionActive()) {
    remeasure();
    return;
  }
  if (waiting) return;
  waiting = true;
  const unsubscribe = subscribeTerminalResizeInteraction((active) => {
    if (active) return;
    unsubscribe();
    waiting = false;
    remeasure();
  });
}
