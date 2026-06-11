import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export type ScreenshotResult = {
  width: number;
  height: number;
  base64: string;
};

export type WindowInfo = {
  id: number;
  ownerName: string;
  windowName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function useScreenCapture() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureScreen = useCallback(
    async (focusedOnly = false): Promise<ScreenshotResult | null> => {
      setLoading(true);
      setError(null);
      try {
        return await invoke<ScreenshotResult>("capture_screen", {
          focusedOnly,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const listWindows = useCallback(async (): Promise<WindowInfo[]> => {
    try {
      return await invoke<WindowInfo[]>("list_windows");
    } catch {
      return [];
    }
  }, []);

  return { captureScreen, listWindows, loading, error };
}
