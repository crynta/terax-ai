import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BlockInputBar, type BlockInputBarHandle } from "./block/BlockInputBar";
import { useTerminalSession } from "./lib/useTerminalSession";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  /** Enable command-block decorations (OSC 133) for this terminal. */
  blocks?: boolean;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      blocks = false,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<BlockInputBarHandle>(null);
    const downYRef = useRef<number | null>(null);
    const { resolvedMode, themeId, customThemes } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      blocks,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    useEffect(() => {
      const node = containerRef.current;
      if (!node) return;
      const handleContextMenu = (event: MouseEvent) => {
        if (session.shouldSuppressContextMenu()) event.preventDefault();
      };
      node.addEventListener("contextmenu", handleContextMenu);
      return () => node.removeEventListener("contextmenu", handleContextMenu);
    }, [session]);

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

    const hideStyle = {
      visibility: visible ? ("visible" as const) : ("hidden" as const),
      pointerEvents: visible ? ("auto" as const) : ("none" as const),
    };

    if (blocks) {
      return (
        <div
          className="zoom-exempt flex h-full w-full flex-col"
          style={hideStyle}
        >
          <BlockInputBar
            ref={barRef}
            mode={session.blockMode}
            onSubmit={session.submitCommand}
            onInterrupt={session.interrupt}
          />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal surface; pointer selects command blocks */}
          <div
            ref={containerRef}
            className="min-h-0 flex-1"
            onMouseDown={(e) => {
              downYRef.current = e.clientY;
            }}
            onMouseUp={(e) => {
              const moved =
                downYRef.current != null &&
                Math.abs(e.clientY - downYRef.current) > 4;
              downYRef.current = null;
              if (!moved) session.selectBlockAt(e.clientY);
              if (session.blockMode === "prompt") barRef.current?.focus();
            }}
          />
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="zoom-exempt h-full w-full"
        style={hideStyle}
      />
    );
  },
);
