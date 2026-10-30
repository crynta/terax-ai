import { IS_MAC } from "@/lib/platform";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

type FullscreenWindowLike = {
  onResized(handler: () => void): Promise<() => void>;
  isFullscreen(): Promise<boolean>;
};

/**
 * Register resize tracking before reading the initial fullscreen state.
 *
 * The revision guard prevents a slower, older read from overwriting a newer
 * resize-triggered read. This closes the startup race where fullscreen could
 * change between the first read and listener registration.
 */
export async function registerFullscreenSync(
  window: FullscreenWindowLike,
  onChange: (fullscreen: boolean) => void,
): Promise<() => void> {
  let revision = 0;

  const sync = async () => {
    const currentRevision = ++revision;
    const fullscreen = await window.isFullscreen();
    if (currentRevision === revision) onChange(fullscreen);
  };

  const unlisten = await window.onResized(() => {
    void sync();
  });
  await sync();
  return unlisten;
}

/** Whether the main window is in macOS fullscreen.
 *
 * Always false off macOS: other platforms render their own window controls and
 * do not reserve header space for native traffic lights.
 */
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!IS_MAC) return;

    let alive = true;
    let unlisten: (() => void) | undefined;
    const window = getCurrentWindow();

    void registerFullscreenSync(window, (value) => {
      if (alive) setFullscreen(value);
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return fullscreen;
}
