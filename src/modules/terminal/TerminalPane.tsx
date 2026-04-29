import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useTerminalSession } from "./lib/useTerminalSession";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  tabId: number;
  visible: boolean;
  initialCwd?: string;
  onSearchReady?: (tabId: number, addon: SearchAddon) => void;
  onExit?: (tabId: number, code: number) => void;
  onCwd?: (tabId: number, cwd: string) => void;
  onDetectedLocalUrl?: (tabId: number, url: string) => void;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    {
      tabId,
      visible,
      initialCwd,
      onSearchReady,
      onExit,
      onCwd,
      onDetectedLocalUrl,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();

    const session = useTerminalSession({
      container: containerRef,
      visible,
      initialCwd,
      onSearchReady: (a) => onSearchReady?.(tabId, a),
      onExit: (c) => onExit?.(tabId, c),
      onCwd: (c) => onCwd?.(tabId, c),
      onDetectedLocalUrl: (u) => onDetectedLocalUrl?.(tabId, u),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedTheme, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    return (
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      />
    );
  },
);
