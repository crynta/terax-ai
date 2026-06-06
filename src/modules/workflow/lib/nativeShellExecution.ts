import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  WorkflowShellCommandExecutor,
  WorkflowShellCommandOutput,
} from "./execution";

export type WorkflowShellPolicyContext = {
  approved: boolean;
  documentId: string;
  nodeId: string;
};

export type WorkflowNativeShellApi = {
  shellBgSpawn: (
    command: string,
    cwd?: string | null,
    policy?: WorkflowShellPolicyContext,
  ) => Promise<number>;
  shellBgLogs: (
    handle: number,
    sinceOffset?: number,
  ) => Promise<{
    bytes: string;
    next_offset: number;
    dropped: number;
    exited: boolean;
    exit_code: number | null;
  }>;
  shellBgKill: (handle: number) => Promise<void>;
};

export type WorkflowNativeShellExecutorOptions = {
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const tauriWorkflowNativeShellApi: WorkflowNativeShellApi = {
  shellBgSpawn: (command, cwd, policy) =>
    invoke<number>("workflow_shell_bg_spawn", {
      request: {
        command,
        cwd: cwd ?? null,
        workspace: currentWorkspaceEnv(),
        approved: policy?.approved ?? false,
        documentId: policy?.documentId ?? "workflow",
        nodeId: policy?.nodeId ?? "shellCommand",
      },
    }),
  shellBgLogs: (handle, sinceOffset) =>
    invoke("shell_bg_logs", { handle, sinceOffset: sinceOffset ?? null }),
  shellBgKill: (handle) => invoke("shell_bg_kill", { handle }),
};

export const tauriWorkflowShellExecutor = createWorkflowNativeShellExecutor();

export function createWorkflowNativeShellExecutor(
  api: WorkflowNativeShellApi = tauriWorkflowNativeShellApi,
  options: WorkflowNativeShellExecutorOptions = {},
): WorkflowShellCommandExecutor {
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 250);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  return async (input) => {
    throwIfAborted(input.signal);
    const handle = await api.shellBgSpawn(input.command, input.cwd ?? null, {
      approved: true,
      documentId: input.document.id,
      nodeId: input.node.id,
    });
    let killed = false;
    let offset = 0;
    let stdout = "";
    let dropped = 0;
    const deadline = input.timeoutSecs
      ? now() + input.timeoutSecs * 1000
      : null;

    try {
      for (;;) {
        throwIfAborted(input.signal);
        const logs = await api.shellBgLogs(handle, offset);
        offset = logs.next_offset;
        dropped += logs.dropped;
        if (logs.bytes.length > 0) {
          stdout += logs.bytes;
          input.reportOutput(logs.bytes);
        }
        if (input.signal?.aborted) {
          killed = true;
          await api.shellBgKill(handle);
          throw abortError();
        }
        if (logs.exited) {
          return shellOutput({
            exitCode: logs.exit_code,
            stdout,
            timedOut: false,
            truncated: dropped > 0,
          });
        }
        if (deadline !== null && now() >= deadline) {
          killed = true;
          await api.shellBgKill(handle);
          const finalLogs = await readFinalLogs(api, handle, offset);
          if (finalLogs.bytes.length > 0) {
            stdout += finalLogs.bytes;
            input.reportOutput(finalLogs.bytes);
          }
          dropped += finalLogs.dropped;
          return shellOutput({
            exitCode: finalLogs.exit_code,
            stdout,
            timedOut: true,
            truncated: dropped > 0,
          });
        }
        await sleep(pollIntervalMs, input.signal);
      }
    } catch (error) {
      if (input.signal?.aborted) {
        if (!killed) await api.shellBgKill(handle).catch(() => {});
        throw abortError();
      }
      throw error;
    }
  };
}

async function readFinalLogs(
  api: WorkflowNativeShellApi,
  handle: number,
  offset: number,
): Promise<{
  bytes: string;
  next_offset: number;
  dropped: number;
  exited: boolean;
  exit_code: number | null;
}> {
  try {
    return await api.shellBgLogs(handle, offset);
  } catch {
    return {
      bytes: "",
      dropped: 0,
      exited: true,
      exit_code: null,
      next_offset: offset,
    };
  }
}

function shellOutput(input: {
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}): WorkflowShellCommandOutput {
  return {
    stdout: input.stdout,
    stderr: "",
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    truncated: input.truncated,
  };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Execution cancelled", "AbortError");
  }
  const error = new Error("Execution cancelled");
  error.name = "AbortError";
  return error;
}
