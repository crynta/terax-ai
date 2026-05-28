import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import type { Event } from "@tauri-apps/api/event";

/**
 * Listens to Tauri's OS-level file drag-drop events and calls `onDrop` when
 * files are dropped inside the given container. Returns `true` while the user
 * is hovering files over this specific pane so the caller can render a
 * drop-highlight.
 *
 * Tauri reports positions in physical pixels (CSS × devicePixelRatio). We
 * convert to CSS pixels before comparing with getBoundingClientRect().
 */
export function useTerminalDragDrop(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onDrop: (paths: string[]) => void,
): boolean {
  const [hovering, setHovering] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let alive = true;

    const unlistenPromise = getCurrentWebview().onDragDropEvent(
      (event: Event<DragDropEvent>) => {
        if (!alive) return;

        // PhysicalPosition → CSS pixel conversion.
        const dpr = window.devicePixelRatio || 1;
        const pos =
          event.payload.type === "over" || event.payload.type === "drop"
            ? {
                x: event.payload.position.x / dpr,
                y: event.payload.position.y / dpr,
              }
            : null;

        if (!pos) {
          // "enter" or "cancel" — just clear hover.
          setHovering(false);
          return;
        }

        const rect = el.getBoundingClientRect();
        const inside =
          pos.x >= rect.left &&
          pos.x <= rect.right &&
          pos.y >= rect.top &&
          pos.y <= rect.bottom;

        if (event.payload.type === "over") {
          setHovering(inside);
        } else if (event.payload.type === "drop" && inside) {
          setHovering(false);
          const paths = event.payload.paths;
          if (paths.length > 0) {
            onDropRef.current(paths);
          }
        } else {
          setHovering(false);
        }
      },
    );

    return () => {
      alive = false;
      void unlistenPromise.then((un) => un());
    };
  }, [containerRef]);

  return hovering;
}
