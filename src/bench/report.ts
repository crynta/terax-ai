import { invoke } from "@tauri-apps/api/core";

export type NativeSnapshot = Record<string, unknown>;

export const nativeWindow = <T = NativeSnapshot>(
  action: Record<string, unknown>,
) => invoke<T>("bench_window", { action });

/**
 * Posts one phase event to the orchestrator and resolves when it has finished sampling the
 * processes (the same request/response protocol as scripts/pty-smoke). The event carries the
 * native snapshot (exact host, WebContent, GPU and Networking pids; window state) taken
 * immediately before the post.
 */
export async function reportPhase(
  reportUrl: string,
  phase: string,
  body: Record<string, unknown>,
): Promise<{ retry: boolean }> {
  const native = await nativeWindow({ cmd: "snapshot" });
  const event = {
    phase,
    tWall: Date.now(),
    uptimeMs: performance.now(),
    native,
    ...body,
  };
  const response = await fetch(`${reportUrl}/event`, {
    method: "POST",
    body: JSON.stringify(event),
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error(`orchestrator refused phase ${phase}: ${response.status}`);
  const reply = (await response.json()) as { retry?: boolean };
  return { retry: Boolean(reply.retry) };
}

export async function reportError(
  reportUrl: string,
  error: unknown,
): Promise<void> {
  const e = error as Error;
  await fetch(`${reportUrl}/event`, {
    method: "POST",
    body: JSON.stringify({
      phase: "error",
      error: String(error),
      stack: e?.stack,
    }),
  }).catch(() => undefined);
}
