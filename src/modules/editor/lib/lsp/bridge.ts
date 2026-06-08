import { invoke, Channel } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  formatLspPayload,
  LSP_DEV_TOOLS,
  lspDebugPatch,
  lspDebugPush,
} from "./debugStore";

export type LspTransport = {
  id: number;
  send: (json: string) => Promise<void>;
  close: () => Promise<void>;
  onMessage: (handler: (json: string) => void) => void;
};

export async function openLspTransport(
  command: string,
  args: string[],
  cwd: string,
): Promise<LspTransport> {
  lspDebugPush("info", "spawning transport", `${command} ${args.join(" ")}`);
  lspDebugPatch({ state: "spawning", command, args, cwd });

  const onMessage = new Channel<string>();
  const onStderr = new Channel<string>();
  let handler: ((json: string) => void) | null = null;
  onMessage.onmessage = (msg) => handler?.(msg);
  onStderr.onmessage = (line) => {
    if (LSP_DEV_TOOLS) lspDebugPush("warn", "stderr", line);
  };

  let id: number;
  try {
    const result = await invoke<{ id: number }>("lsp_spawn", {
      command,
      args,
      cwd,
      workspace: currentWorkspaceEnv(),
      onMessage,
      onStderr,
    });
    id = result.id;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lspDebugPush("error", "lsp_spawn failed", message);
    lspDebugPatch({ state: "error", error: message });
    throw e;
  }

  lspDebugPush("info", "transport ready", `id=${id}`);
  lspDebugPatch({ transportId: id, state: "spawning", error: null });

  let closed = false;
  return {
    id,
    send: async (json) => {
      if (LSP_DEV_TOOLS) {
        const parsed = JSON.parse(json) as { method?: string; id?: number };
        const tag = parsed.method
          ? `${parsed.method}`
          : parsed.id != null
            ? `response id=${parsed.id}`
            : "message";
        lspDebugPush("out", tag, formatLspPayload(json));
      }
      try {
        await invoke("lsp_send", { id, message: json });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        lspDebugPush("error", "lsp_send failed", message);
        lspDebugPatch({ state: "error", error: message });
        throw e;
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      handler = null;
      onMessage.onmessage = () => {};
      lspDebugPush("info", "closing transport", `id=${id}`);
      await invoke("lsp_close", { id });
      lspDebugPatch({ state: "closed", transportId: null });
    },
    onMessage: (fn) => {
      handler = LSP_DEV_TOOLS
        ? (json) => {
            try {
              const parsed = JSON.parse(json) as {
                method?: string;
                id?: number;
              };
              const tag = parsed.method
                ? `${parsed.method}`
                : parsed.id != null
                  ? `response id=${parsed.id}`
                  : "message";
              lspDebugPush("in", tag, formatLspPayload(json));
            } catch {
              lspDebugPush("in", "raw", json.slice(0, 280));
            }
            fn(json);
          }
        : fn;
    },
  };
}
