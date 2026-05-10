import { IS_WINDOWS, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { cn } from "@/lib/utils";
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
    <div className={cn("flex h-full shrink-0 items-center", IS_WINDOWS ? "" : "gap-0.5 pr-1")}>
      <CtlButton
        ariaLabel="Minimize"
        onClick={() => void w.minimize()}
        windowsStyle={IS_WINDOWS}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0 5 H10" />
        </svg>
      </CtlButton>
      <CtlButton
        ariaLabel={maximized ? "Restore" : "Maximize"}
        onClick={() => void w.toggleMaximize()}
        windowsStyle={IS_WINDOWS}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M2.5 0.5 H9.5 V7.5 H7.5" />
            <rect x="0.5" y="2.5" width="7" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </CtlButton>
      <CtlButton
        ariaLabel="Close"
        onClick={() => void w.close()}
        windowsStyle={IS_WINDOWS}
        danger
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" />
        </svg>
      </CtlButton>
    </div>
  );
}

function CtlButton({
  ariaLabel,
  onClick,
  children,
  windowsStyle,
  danger,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  windowsStyle: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className={cn(
        "grid place-items-center text-muted-foreground transition-colors",
        windowsStyle
          ? "h-10 w-11"
          : "size-7 rounded-md",
        danger
          ? windowsStyle
            ? "hover:bg-[#e81123] hover:text-white"
            : "hover:bg-destructive/15 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
