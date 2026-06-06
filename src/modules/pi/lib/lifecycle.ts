import type { PiRuntimeState } from "@/modules/pi/lib/status";

export type PiPrewarmInput = {
  attempted: boolean;
  isBusy: boolean;
  runtimeState: PiRuntimeState;
};

export function shouldPrewarmPiRuntime({
  attempted,
  isBusy,
  runtimeState,
}: PiPrewarmInput): boolean {
  if (attempted || isBusy) return false;
  return (
    runtimeState.phase === "disconnected" || runtimeState.phase === "error"
  );
}
