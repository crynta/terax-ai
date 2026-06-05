import { Channel, invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { CliSpawnEvent } from "./types";

let nextSpawnId = 1;
export function allocateSpawnId(): number {
  // u32 on the Rust side; wrap well below the limit.
  nextSpawnId = (nextSpawnId % 0x7fff_ffff) + 1;
  return nextSpawnId;
}

/** Map of requested binary names to their resolved absolute path (or null). */
export function detectCliAgents(
  bins: string[],
): Promise<Record<string, string | null>> {
  return invoke<Record<string, string | null>>("agent_cli_which", { bins });
}

export function killCliAgent(id: number): Promise<void> {
  return invoke<void>("agent_cli_kill", { id }).catch(() => {});
}

type RunHandlers = {
  onStdout: (line: string) => void;
  onStderr?: (line: string) => void;
};

/**
 * Spawn a CLI agent and stream its line output. Resolves with the exit code
 * once the process ends; rejects only if the spawn itself fails before any
 * output. `id` should come from `allocateSpawnId()` so the caller can cancel.
 */
export function runCliAgent(
  args: { id: number; argv: string[]; cwd: string | null },
  handlers: RunHandlers,
): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    let started = false;
    const channel = new Channel<CliSpawnEvent>();
    channel.onmessage = (event) => {
      switch (event.kind) {
        case "stdout":
          started = true;
          handlers.onStdout(event.line);
          break;
        case "stderr":
          started = true;
          handlers.onStderr?.(event.line);
          break;
        case "exit":
          resolve({ code: event.code });
          break;
        case "error":
          if (started) resolve({ code: null });
          else reject(new Error(event.message));
          break;
      }
    };

    invoke<void>("agent_cli_spawn", {
      id: args.id,
      argv: args.argv,
      cwd: args.cwd ?? undefined,
      workspace: currentWorkspaceEnv(),
      onEvent: channel,
    }).catch((e) => {
      if (started) return;
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
