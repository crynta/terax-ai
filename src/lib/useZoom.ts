import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setZoomLevel as saveZoomToStore } from "@/modules/settings/store";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

export function useZoom() {
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);

  // Apply persisted zoom level on mount (if hydrated)
  const hydrated = usePreferencesStore((s) => s.hydrated);
  useEffect(() => {
    if (hydrated) {
      void getCurrentWebview().setZoom(zoomLevel);
    }
  }, [hydrated, zoomLevel]);

  const applyZoom = useCallback(
    (newZoom: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
      void saveZoomToStore(clamped);
      void getCurrentWebview().setZoom(clamped);
    },
    [],
  );

  const zoomIn = useCallback(() => {
    applyZoom(zoomLevel + ZOOM_STEP);
  }, [zoomLevel, applyZoom]);

  const zoomOut = useCallback(() => {
    applyZoom(zoomLevel - ZOOM_STEP);
  }, [zoomLevel, applyZoom]);

  const zoomReset = useCallback(() => {
    applyZoom(1.0);
  }, [applyZoom]);

  return { zoomLevel, zoomIn, zoomOut, zoomReset };
}
