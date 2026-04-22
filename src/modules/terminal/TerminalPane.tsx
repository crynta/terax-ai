import type { SearchAddon } from "@xterm/addon-search";
import { useRef } from "react";
import { useTerminalSession } from "./lib/useTerminalSession";

type Props = {
  tabId: number;
  visible: boolean;
  onSearchReady?: (tabId: number, addon: SearchAddon) => void;
  onExit?: (tabId: number, code: number) => void;
  onCwd?: (tabId: number, cwd: string) => void;
};

export function TerminalPane({
  tabId,
  visible,
  onSearchReady,
  onExit,
  onCwd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useTerminalSession({
    container: containerRef,
    visible,
    onSearchReady: (a) => onSearchReady?.(tabId, a),
    onExit: (c) => onExit?.(tabId, c),
    onCwd: (c) => onCwd?.(tabId, c),
  });

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
