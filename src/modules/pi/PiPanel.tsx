import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { piNative } from "./lib/native";
import {
  getPiStatusView,
  type PiRuntimeState,
  type PiStatusView,
} from "./lib/status";

const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

function statusDotClass(tone: PiStatusView["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500/80";
    case "progress":
      return "bg-sky-500/80";
    case "error":
      return "bg-destructive";
    case "muted":
      return "bg-muted-foreground/35";
  }
}

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function PiPanel() {
  const [runtimeState, setRuntimeState] = useState(INITIAL_PI_STATE);
  const [isBusy, setIsBusy] = useState(false);
  const status = getPiStatusView(runtimeState);

  const refreshStatus = useCallback(async () => {
    try {
      setRuntimeState(await piNative.status());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const startRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeState({ phase: "starting", detail: "Starting Pi" });
    try {
      setRuntimeState(await piNative.start());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const stopRuntime = useCallback(async () => {
    setIsBusy(true);
    try {
      setRuntimeState(await piNative.stop());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  return (
    <aside
      aria-label="Pi sessions"
      className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]"
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <div className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground">
          <HugeiconsIcon
            icon={AiChat02Icon}
            size={12}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate">Pi</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-border/55 px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusDotClass(status.tone),
            )}
          />
          <span>{status.label}</span>
        </div>
      </header>

      <div className="shrink-0 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 py-2.5">
        <div className="rounded-lg border border-border/45 bg-background/95 px-2.5 py-2 shadow-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">
              Runtime
            </span>
            <span className="ml-auto shrink-0 text-[10.5px] font-medium text-muted-foreground">
              {status.canStart ? "Idle" : "Active"}
            </span>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            {runtimeState.detail ??
              "Connect the Pi runtime to show active sessions in this sidebar."}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              size="xs"
              className="h-6 flex-1"
              disabled={!status.canStart || isBusy}
              onClick={() => void startRuntime()}
            >
              Start
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="h-6 flex-1"
              disabled={!status.canStop || isBusy}
              onClick={() => void stopRuntime()}
            >
              Stop
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-7 shrink-0 items-center gap-2 px-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
            Sessions
          </span>
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
            0
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
          <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
            <HugeiconsIcon icon={AiChat02Icon} size={16} strokeWidth={1.6} />
          </div>
          <div className="text-[12px] font-medium text-foreground">
            No Pi sessions
          </div>
          <div className="max-w-52 text-[10.5px] leading-snug text-muted-foreground">
            New sessions will appear here when the runtime is connected.
          </div>
        </div>
      </div>
    </aside>
  );
}
