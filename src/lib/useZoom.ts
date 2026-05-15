import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useState } from "react";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

export function useZoom() {
  const [zoomLevel, setZoomLevel] = useState(1.0);

  useEffect(() => {
    // Tauri 2 Webview doesn't currently expose getZoom in the JS API.
    // We'll start at 1.0 and track it locally.
  }, []);

  const applyZoom = useCallback((newZoom: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    setZoomLevel(clamped);
    void getCurrentWebview().setZoom(clamped);
  }, []);

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
