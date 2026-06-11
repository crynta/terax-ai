import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";

export type AnnotationItem =
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      strokeWidth?: number;
    }
  | {
      type: "circle";
      cx: number;
      cy: number;
      radius: number;
      color?: string;
      strokeWidth?: number;
    }
  | {
      type: "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color?: string;
      strokeWidth?: number;
    }
  | {
      type: "text";
      x: number;
      y: number;
      content: string;
      fontSize?: number;
      color?: string;
    }
  | {
      type: "scribble";
      points: [number, number][];
      color?: string;
      strokeWidth?: number;
    };

export function useAnnotationOverlay() {
  const show = useCallback(async () => {
    await invoke("overlay_show");
  }, []);

  const hide = useCallback(async () => {
    await invoke("overlay_hide");
  }, []);

  const draw = useCallback(async (items: AnnotationItem[]) => {
    await invoke("overlay_draw", { items });
  }, []);

  const clear = useCallback(async () => {
    await invoke("overlay_clear");
  }, []);

  return { show, hide, draw, clear };
}
