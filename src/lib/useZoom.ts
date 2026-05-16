import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setZoomLevel } from "@/modules/settings/store";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

function clampZoom(z: number): number {
  const rounded = Math.round(z * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

export function useZoom() {
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const lastAppliedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (lastAppliedRef.current === zoomLevel) return;
    lastAppliedRef.current = zoomLevel;
    void getCurrentWebview().setZoom(zoomLevel);
  }, [hydrated, zoomLevel]);

  const zoomIn = useCallback(() => {
    const current = usePreferencesStore.getState().zoomLevel;
    const next = clampZoom(current + ZOOM_STEP);
    if (next !== current) void setZoomLevel(next);
  }, []);

  const zoomOut = useCallback(() => {
    const current = usePreferencesStore.getState().zoomLevel;
    const next = clampZoom(current - ZOOM_STEP);
    if (next !== current) void setZoomLevel(next);
  }, []);

  const zoomReset = useCallback(() => {
    if (usePreferencesStore.getState().zoomLevel !== 1.0) {
      void setZoomLevel(1.0);
    }
  }, []);

  return { zoomIn, zoomOut, zoomReset };
}
