import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import type { PiRuntimeState, PiStatusView } from "@/modules/pi/lib/status";

type PiRuntimeAction = "starting" | "stopping" | "restarting" | null;

type PiRuntimeCardProps = {
  isBusy: boolean;
  runtimeAction?: PiRuntimeAction;
  runtimeState: PiRuntimeState;
  status: PiStatusView;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
};

function runtimeActionLabel(action: PiRuntimeAction): string | null {
  switch (action) {
    case "starting":
      return "Starting Pi runtime…";
    case "stopping":
      return "Stopping Pi runtime…";
    case "restarting":
      return "Restarting Pi runtime…";
    case null:
    case undefined:
      return null;
  }
}

export function PiRuntimeCard({
  isBusy,
  runtimeAction = null,
  runtimeState,
  status,
  onStart,
  onStop,
  onRestart,
}: PiRuntimeCardProps) {
  const actionLabel = runtimeActionLabel(runtimeAction);
  const restartPrimary = runtimeState.phase === "error";
  const showSpinner =
    runtimeAction !== null || runtimeState.phase === "starting";
  const detail =
    actionLabel ??
    runtimeState.detail ??
    (runtimeState.phase === "error"
      ? "The Pi runtime stopped unexpectedly."
      : "Connect the Pi runtime to show active sessions in this sidebar.");

  return (
    <div className="shrink-0 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 py-2.5">
      <div className="flex flex-col gap-2 rounded-lg border border-border/45 bg-background/95 px-2.5 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon
              icon={AiChat02Icon}
              size={12}
              strokeWidth={1.85}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate text-[12px] font-medium text-foreground">
              Runtime
            </span>
          </div>
          <Badge
            variant="outline"
            className="ml-auto h-5 gap-1 rounded-md border-border/55 px-1.5 text-[10px] text-muted-foreground"
          >
            {showSpinner ? <Spinner className="size-2.5" /> : null}
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                statusToneDotClass(status.tone),
              )}
            />
            {status.label}
          </Badge>
        </div>

        {runtimeState.phase === "error" ? (
          <Alert
            variant="destructive"
            className="rounded-lg border-destructive/35 px-2.5 py-2 text-[11px]"
          >
            <AlertTitle className="text-[11px]">Pi needs attention</AlertTitle>
            <AlertDescription className="text-[10.5px] leading-snug">
              {detail}
              <span className="mt-1 block">
                Restart Pi to reset the webview runtime. If this keeps failing,
                refresh diagnostics or check Settings &gt; Models.
              </span>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {detail}
          </p>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          <Button
            size="xs"
            variant={restartPrimary ? "outline" : "default"}
            className="h-6 rounded-md text-[10.5px]"
            aria-label="Start Pi runtime"
            disabled={!status.canStart || isBusy}
            onClick={onStart}
          >
            {runtimeAction === "starting" ? "Starting…" : "Start"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-6 rounded-md text-[10.5px]"
            aria-label="Stop Pi runtime"
            disabled={!status.canStop || isBusy}
            onClick={onStop}
          >
            {runtimeAction === "stopping" ? "Stopping…" : "Stop"}
          </Button>
          <Button
            size="xs"
            variant={restartPrimary ? "default" : "outline"}
            className="h-6 rounded-md text-[10.5px]"
            aria-label="Restart Pi runtime"
            data-primary-runtime-action={restartPrimary ? "restart" : undefined}
            disabled={(!status.canStart && !status.canStop) || isBusy}
            onClick={onRestart}
          >
            {runtimeAction === "restarting" ? "Restarting…" : "Restart"}
          </Button>
        </div>
      </div>
    </div>
  );
}
