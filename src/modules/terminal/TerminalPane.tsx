import { IS_WINDOWS } from "@/lib/platform";
import { useTheme } from "@/modules/theme";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchAddon } from "@xterm/addon-search";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { isDropPointInsideRect } from "./lib/drop-hitbox";
import { buildDroppedPathInput } from "./lib/drop-paths";
import {
  useTerminalSession,
  type TeraxOpenInput,
} from "./lib/useTerminalSession";

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
  onTeraxOpen?: (tabId: number, input: TeraxOpenInput) => void;
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
      onTeraxOpen,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const visibleRef = useRef(visible);
    const sessionRef = useRef<ReturnType<typeof useTerminalSession> | null>(
      null,
    );
    const [dropActive, setDropActive] = useState(false);
    const { resolvedTheme } = useTheme();

    const session = useTerminalSession({
      container: containerRef,
      visible,
      initialCwd,
      onSearchReady: (a) => onSearchReady?.(tabId, a),
      onExit: (c) => onExit?.(tabId, c),
      onCwd: (c) => onCwd?.(tabId, c),
      onDetectedLocalUrl: (u) => onDetectedLocalUrl?.(tabId, u),
      onTeraxOpen: (input) => onTeraxOpen?.(tabId, input),
    });
    sessionRef.current = session;

    useEffect(() => {
      visibleRef.current = visible;
      if (!visible) setDropActive(false);
    }, [visible]);

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

    useEffect(() => {
      let disposed = false;
      let scaleFactor = window.devicePixelRatio || 1;

      try {
        void getCurrentWindow()
          .scaleFactor()
          .then((factor) => {
            if (!disposed) scaleFactor = factor || 1;
          })
          .catch(() => {
            scaleFactor = 1;
          });

        const unlisten = getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          const payload = event.payload;
          if (payload.type === "leave") {
            setDropActive(false);
            return;
          }
          if (!visibleRef.current) return;

          const container = containerRef.current;
          if (!container) return;
          const inside = isDropInside(payload, container, scaleFactor);
          setDropActive(inside && payload.type !== "drop");

          if (payload.type !== "drop" || !inside) return;
          const input = buildDroppedPathInput(
            payload.paths,
            IS_WINDOWS ? "windows" : "unix",
          );
          if (!input) return;
          sessionRef.current?.focus();
          sessionRef.current?.write(input);
        });

        return () => {
          disposed = true;
          void unlisten.then((fn) => fn()).catch(console.error);
        };
      } catch (error) {
        console.warn("Terminal file drop unavailable:", error);
        return () => {
          disposed = true;
        };
      }
    }, []);

    return (
      <div className="relative h-full w-full">
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{
            visibility: visible ? "visible" : "hidden",
            pointerEvents: visible ? "auto" : "none",
          }}
        />
        {dropActive ? (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
            Drop file path into terminal
          </div>
        ) : null}
      </div>
    );
  },
);

function isDropInside(
  payload: Extract<DragDropEvent, { type: "enter" | "over" | "drop" }>,
  element: HTMLElement,
  scaleFactor: number,
): boolean {
  const rect = element.getBoundingClientRect();
  return isDropPointInsideRect(
    payload.position,
    rect,
    { width: window.innerWidth, height: window.innerHeight },
    scaleFactor,
  );
}
