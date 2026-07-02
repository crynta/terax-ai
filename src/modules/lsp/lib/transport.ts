import { currentWorkspaceEnv } from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Transport } from "codemirror-languageserver";

export type LspSpawnConfig = {
  command: string;
  args: string[];
  root: string;
  env?: Record<string, string>;
};

export type LspExitInfo = {
  code: number | null;
  stderrTail: string;
};

type ServerRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

function isServerRequest(msg: unknown): msg is ServerRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    (msg as ServerRequest).id != null &&
    "method" in msg
  );
}

export class TauriLspTransport implements Transport {
  private sessionId: number | null = null;
  private closed = false;
  private onMsg: ((message: string) => void) | null = null;
  private onCloseCb: (() => void) | null = null;
  private onErrorCb: ((error: Error) => void) | null = null;
  private backlog: string[] = [];
  exitInfo: LspExitInfo | null = null;

  async start(config: LspSpawnConfig): Promise<void> {
    const decoder = new TextDecoder();
    const onMessage = new Channel<ArrayBuffer>();
    onMessage.onmessage = (buf) => {
      const text = decoder.decode(buf);
      this.answerServerRequest(text);
      if (this.onMsg) this.onMsg(text);
      else this.backlog.push(text);
    };
    const onExit = new Channel<LspExitInfo>();
    onExit.onmessage = (info) => {
      this.exitInfo = info;
      this.closed = true;
      this.onCloseCb?.();
    };
    this.sessionId = await invoke<number>("lsp_spawn", {
      command: config.command,
      args: config.args,
      env: config.env ?? null,
      root: config.root,
      workspace: currentWorkspaceEnv(),
      onMessage,
      onExit,
    });
  }

  // The client library ignores server-to-client requests entirely.
  private answerServerRequest(text: string): void {
    // Cheap pre-check: requests carry both markers; skips a redundant
    // JSON.parse of large notification payloads like publishDiagnostics.
    if (!text.includes('"id"') || !text.includes('"method"')) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!isServerRequest(msg)) return;
    const reply = (body: Record<string, unknown>) =>
      this.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }));
    switch (msg.method) {
      case "workspace/configuration": {
        const items =
          (msg.params as { items?: unknown[] } | undefined)?.items ?? [];
        reply({ result: items.map(() => null) });
        return;
      }
      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
      case "window/showMessageRequest":
      case "workspace/workspaceFolders":
        reply({ result: null });
        return;
      default:
        reply({
          error: { code: -32601, message: `unhandled method ${msg.method}` },
        });
    }
  }

  send(message: string): void {
    if (this.sessionId == null || this.closed) return;
    void invoke("lsp_send", { id: this.sessionId, message }).catch((e) => {
      this.onErrorCb?.(new Error(String(e)));
    });
  }

  onMessage(callback: (message: string) => void): void {
    this.onMsg = callback;
    if (this.backlog.length > 0) {
      const queued = this.backlog;
      this.backlog = [];
      for (const m of queued) callback(m);
    }
  }

  onClose(callback: () => void): void {
    this.onCloseCb = callback;
    if (this.closed) callback();
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCb = callback;
  }

  close(): void {
    if (this.closed) {
      this.sessionId = null;
      return;
    }
    this.closed = true;
    if (this.sessionId != null) {
      void invoke("lsp_kill", { id: this.sessionId }).catch(() => {});
      this.sessionId = null;
    }
  }
}
