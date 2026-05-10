import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  Copy01Icon,
  MinusSignIcon,
  Square01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

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
    <div className="flex h-full shrink-0 items-center gap-0.5 pr-1">
      <CtlButton
        ariaLabel="Minimize"
        onClick={() => void w.minimize()}
      >
        <HugeiconsIcon icon={MinusSignIcon} size={13} strokeWidth={1.75} />
      </CtlButton>
      <CtlButton
        ariaLabel={maximized ? "Restore" : "Maximize"}
        onClick={() => void w.toggleMaximize()}
      >
        <HugeiconsIcon
          icon={maximized ? Copy01Icon : Square01Icon}
          size={13}
          strokeWidth={1.75}
        />
      </CtlButton>
      <CtlButton
        ariaLabel="Close"
        onClick={() => void w.close()}
        danger
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
      </CtlButton>
    </div>
  );
}

function CtlButton({
  ariaLabel,
  onClick,
  children,
  danger,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors",
        danger
          ? "hover:bg-destructive/15 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
