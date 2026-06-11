import Shield01Icon from "@hugeicons/core-free-icons/shield01";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/checkmarkCircle02";
import CancelCircleIcon from "@hugeicons/core-free-icons/cancelCircle";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";

import { cn } from "@/lib/utils";
import { caps } from "@/lib/platformCapabilities";
import { SidebarPanelBody, SidebarPanelFrame } from "@/modules/sidebar";

type Permission = {
  id: string;
  label: string;
  description: string;
  supported: boolean;
};

const PERMISSIONS: Permission[] = [
  {
    id: "microphone",
    label: "Microphone",
    description: "Required for voice input and wake word detection",
    supported: caps.localStt,
  },
  {
    id: "screen-capture",
    label: "Screen Capture",
    description: "Required for screenshot and annotation tools",
    supported: caps.screenCapture,
  },
  {
    id: "speech",
    label: "Speech Synthesis",
    description: "Required for text-to-speech playback",
    supported: caps.nativeTts,
  },
  {
    id: "global-shortcut",
    label: "Global Shortcuts",
    description: "Required for push-to-talk hotkey",
    supported: caps.tray,
  },
];

type Props = {
  open: boolean;
};

export const PermissionsSetup = memo(function PermissionsSetup({
  open,
}: Props) {
  if (!open) return null;

  const grantedCount = PERMISSIONS.filter((p) => p.supported).length;
  const allGranted = grantedCount === PERMISSIONS.length;

  return (
    <SidebarPanelFrame aria-label="Permissions">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 pb-2.5 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <HugeiconsIcon
            icon={Shield01Icon}
            size={14}
            strokeWidth={1.75}
            className="text-muted-foreground"
          />
          <span className="text-[11.5px] font-medium text-foreground">
            Permissions
          </span>
        </div>
      </header>

      <SidebarPanelBody>
        <div className="flex flex-col gap-3 p-3">
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {allGranted
              ? "All permissions are granted. Voice, screen capture, and shortcuts are available."
              : `${grantedCount} of ${PERMISSIONS.length} permissions granted. Grant access in System Settings to enable features.`}
          </div>

          <div className="flex flex-col gap-2">
            {PERMISSIONS.map((perm) => (
              <div
                key={perm.id}
                className="flex items-start gap-2 rounded-md border border-border/40 px-2.5 py-2"
              >
                <HugeiconsIcon
                  icon={
                    perm.supported ? CheckmarkCircle02Icon : CancelCircleIcon
                  }
                  size={14}
                  strokeWidth={1.75}
                  className={cn(
                    "mt-0.5 shrink-0",
                    perm.supported
                      ? "text-green-500"
                      : "text-muted-foreground/50",
                  )}
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[11.5px] font-medium text-foreground">
                    {perm.label}
                  </span>
                  <span className="text-[10.5px] leading-relaxed text-muted-foreground/75">
                    {perm.description}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {!allGranted && (
            <div className="mt-1 rounded-md border border-border/40 bg-muted/30 px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              Open System Settings &gt; Privacy &amp; Security to grant
              microphone and screen recording access.
            </div>
          )}
        </div>
      </SidebarPanelBody>
    </SidebarPanelFrame>
  );
});
