import { useEffect } from "react";
import { installLivePageResizeInBrowser } from "./livePageResize";

/**
 * Marks `<html>` with `data-live-resize` while the window is being resized so
 * the page keeps one tile size across the drag (see `livePageResize`). Only the
 * macOS WebKit web view re-tiles per step; elsewhere it is not mounted.
 */
export function LivePageResizeBridge() {
  useEffect(() => installLivePageResizeInBrowser(), []);
  return null;
}
