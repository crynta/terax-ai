import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(() =>
    typeof document !== "undefined" ? document.hasFocus() : true,
  );

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return focused;
}
