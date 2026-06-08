import {
  rpcNotification,
  rpcRequest,
  rpcResponse,
  type JsonRpcMessage,
} from "./protocol";
import type { LspTransport } from "./bridge";
import { lspDebugPush } from "./debugStore";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export class LspConnection {
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(msg: JsonRpcMessage) => void>();
  private readonly refreshListeners = new Set<() => void>();
  readonly ready: Promise<void>;

  private constructor(
    private readonly transport: LspTransport,
    readonly rootUri: string,
    private readonly serverCommand: string,
  ) {
    this.transport.onMessage((json) => this.onRawMessage(json));
    this.ready = this.initialize();
  }

  static async open(
    transport: LspTransport,
    rootUri: string,
    serverCommand: string,
  ): Promise<LspConnection> {
    const conn = new LspConnection(transport, rootUri, serverCommand);
    await conn.ready;
    return conn;
  }

  private onRawMessage(json: string) {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(json) as JsonRpcMessage;
    } catch {
      return;
    }
    if (msg.id != null && msg.method && !this.pending.has(msg.id as number)) {
      this.handleServerRequest(msg);
      return;
    }
    if (msg.id != null && this.pending.has(msg.id as number)) {
      const entry = this.pending.get(msg.id as number);
      this.pending.delete(msg.id as number);
      if (msg.error) {
        entry?.reject(new Error(msg.error.message));
      } else {
        entry?.resolve(msg.result);
      }
      return;
    }
    for (const listener of this.listeners) listener(msg);
  }

  private handleServerRequest(msg: JsonRpcMessage) {
    const id = msg.id as number;
    const method = msg.method ?? "unknown";
    lspDebugPush("in", `server request ${method}`, "");
    switch (method) {
      case "workspace/diagnostic/refresh":
        for (const cb of this.refreshListeners) cb();
        void this.transport.send(rpcResponse(id, null));
        break;
      case "workspace/applyEdit":
      case "client/registerCapability":
      case "window/workDoneProgress/create":
      case "window/showMessageRequest":
        void this.transport.send(rpcResponse(id, null));
        break;
      default:
        lspDebugPush("warn", "unhandled server request", method);
        void this.transport.send(rpcResponse(id, null));
    }
  }

  subscribe(listener: (msg: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDiagnosticRefresh(cb: () => void): () => void {
    this.refreshListeners.add(cb);
    return () => this.refreshListeners.delete(cb);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const { id, payload } = rpcRequest(method, params);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.transport.send(payload).catch(reject);
    });
  }

  notify(method: string, params: unknown) {
    void this.transport.send(rpcNotification(method, params));
  }

  private initOptions(): unknown | undefined {
    if (this.serverCommand.includes("rust-analyzer")) {
      return {
        cargo: { buildScripts: { enable: true } },
        procMacro: { enable: true },
      };
    }
    if (this.serverCommand.includes("deps-lsp")) {
      return {
        inlay_hints: {
          enabled: true,
          needs_update_text: "→ {}",
        },
        diagnostics: {
          outdated_severity: "hint",
        },
      };
    }
    return undefined;
  }

  private async initialize() {
    const rootName =
      decodeURIComponent(this.rootUri.split("/").pop() ?? "") || "workspace";
    const initOptions = this.initOptions();
    await this.request("initialize", {
      processId: null,
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: rootName }],
      ...(initOptions ? { initializationOptions: initOptions } : {}),
      capabilities: {
        general: { positionEncodings: ["utf-8"] },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: false,
              labelDetailsSupport: true,
            },
          },
          publishDiagnostics: { relatedInformation: false },
          hover: { dynamicRegistration: false },
          diagnostic: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          inlayHint: { dynamicRegistration: false },
        },
      },
    });
    this.notify("initialized", {});
  }

  async close() {
    await this.transport.close();
  }
}
