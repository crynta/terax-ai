import type { Terminal } from "@xterm/xterm";

type MouseTrackingMode = Terminal["modes"]["mouseTrackingMode"];

export function shouldSuppressTerminalContextMenu(
  mode: MouseTrackingMode | null | undefined,
): boolean {
  return mode != null && mode !== "none";
}
