import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import type {
  PiDiagnostics,
  PiRuntimeState,
  PiStatusView,
} from "@/modules/pi/lib/status";

type PiRuntimeCardProps = {
  diagnostics: PiDiagnostics | null;
  isBusy: boolean;
  runtimeState: PiRuntimeState;
  status: PiStatusView;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
};

export function PiRuntimeCard({
  diagnostics,
  isBusy,
  runtimeState,
  status,
  onStart,
  onStop,
  onRestart,
}: PiRuntimeCardProps) {
  const loadedPackageCount =
    diagnostics?.piPackages.filter((pkg) => pkg.loaded).length ?? 0;
  const configuredApiKeyCount =
    diagnostics?.config.apiKeys.filter((key) => key.configured).length ?? 0;
  const detail =
    runtimeState.detail ??
    "Connect the Pi runtime to show active sessions in this sidebar.";

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
            className="ml-auto h-5 gap-1 border-border/55 px-1.5 text-[10px] text-muted-foreground"
          >
            {isBusy || runtimeState.phase === "starting" ? (
              <Spinner className="size-2.5" />
            ) : null}
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
            className="h-6"
            disabled={!status.canStart || isBusy}
            onClick={onStart}
          >
            Start
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-6"
            disabled={!status.canStop || isBusy}
            onClick={onStop}
          >
            Stop
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="h-6"
            disabled={(!status.canStart && !status.canStop) || isBusy}
            onClick={onRestart}
          >
            Restart
          </Button>
        </div>

        {diagnostics ? (
          <div className="flex flex-col gap-1 border-t border-border/35 pt-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Badge
                variant="secondary"
                className="h-5 min-w-0 max-w-full px-1.5 text-[10px]"
              >
                <span className="truncate">
                  Node {diagnostics.node.version}
                </span>
              </Badge>
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] text-muted-foreground"
              >
                PID {diagnostics.node.pid}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
              <span className="truncate rounded-md border border-border/35 bg-card/60 px-1.5 py-1">
                Pi packages {loadedPackageCount}/{diagnostics.piPackages.length}
              </span>
              <span className="truncate rounded-md border border-border/35 bg-card/60 px-1.5 py-1 text-right">
                API keys {configuredApiKeyCount}/
                {diagnostics.config.apiKeys.length}
              </span>
              <span className="col-span-2 truncate rounded-md border border-border/35 bg-card/60 px-1.5 py-1">
                Tools: {diagnostics.config.toolMode}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
