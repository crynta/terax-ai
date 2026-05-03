import {
  Cancel01Icon,
  Copy01Icon,
  MinusSignIcon,
  Square01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!USE_CUSTOM_WINDOW_CONTROLS) return;
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void w.isMaximized().then(setMaximized);
    void w
      .onResized(() => {
        void w.isMaximized().then(setMaximized);
      })
      .then((un) => {
        unlisten = un;
      });
    return () => unlisten?.();
  }, []);

  if (!USE_CUSTOM_WINDOW_CONTROLS) return null;

  const w = getCurrentWindow();

  return (
    <div className="flex h-full shrink-0 items-center">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => void w.minimize()}
        className="grid h-full w-10 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={MinusSignIcon} size={14} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void w.toggleMaximize()}
        className="grid h-full w-10 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon
          icon={maximized ? Copy01Icon : Square01Icon}
          size={13}
          strokeWidth={1.75}
        />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => void w.close()}
        className="grid h-full w-10 place-items-center text-muted-foreground hover:bg-red-600 hover:text-white"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
