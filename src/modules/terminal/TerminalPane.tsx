import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { quoteShellArg } from "@/lib/shellQuote";
import { useTerminalSession } from "./lib/useTerminalSession";
import { useTerminalDragDrop } from "./lib/useTerminalDragDrop";

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
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedMode, themeId, customThemes } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    const handleDrop = useCallback(
      (paths: string[]) => {
        const quoted = paths.map((p) => quoteShellArg(p)).join(" ");
        session.write(quoted + " ");
      },
      [session],
    );

    const dropHovering = useTerminalDragDrop(containerRef, handleDrop);

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
        className="zoom-exempt relative h-full w-full"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        {dropHovering && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded border-2 border-dashed border-ring/70 bg-primary/10">
            <span className="rounded-md bg-card/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm">
              Drop files here
            </span>
          </div>
        )}
      </div>
    );
  },
);
