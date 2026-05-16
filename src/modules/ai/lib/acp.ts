import { invoke } from "@tauri-apps/api/core";
import {
  type LanguageModel,
} from "ai";

export type AcpMessage = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

export class AcpClient {
  private handle: number | null = null;
  private offset = 0;
  private buffer = "";
  private pendingRequests = new Map<
    string | number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  private onNotification?: (method: string, params: any) => void;
  private onRequest?: (method: string, params: any) => Promise<any>;

  constructor(private command: string, private cwd?: string | null) {}

  async start() {
    this.handle = await invoke<number>("shell_bg_spawn", {
      command: this.command,
      cwd: this.cwd ?? null,
    });
    this.startPolling();
  }

  async stop() {
    if (this.handle !== null) {
      await invoke("shell_bg_kill", { handle: this.handle });
      this.handle = null;
    }
  }

  async request(method: string, params: any): Promise<any> {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: any) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  setHandlers(handlers: {
    onNotification?: (method: string, params: any) => void;
    onRequest?: (method: string, params: any) => Promise<any>;
  }) {
    this.onNotification = handlers.onNotification;
    this.onRequest = handlers.onRequest;
  }

  private async send(msg: AcpMessage) {
    if (this.handle === null) throw new Error("ACP client not started");
    const data = JSON.stringify(msg) + "\n";
    await invoke("shell_bg_stdin", { handle: this.handle, data });
  }

  private async startPolling() {
    while (this.handle !== null) {
      try {
        const resp = await invoke<{
          bytes: string;
          next_offset: number;
          exited: boolean;
        }>("shell_bg_logs", {
          handle: this.handle,
          sinceOffset: this.offset,
        });

        this.offset = resp.next_offset;
        if (resp.bytes) {
          this.buffer += resp.bytes;
          this.processBuffer();
        }

        if (resp.exited) {
          this.handle = null;
          this.cleanupPending(new Error("ACP process exited"));
          break;
        }
      } catch (e) {
        console.error("ACP poll failed", e);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private processBuffer() {
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line) as AcpMessage;
          this.handleMessage(msg);
        } catch (e) {
          console.error("Failed to parse ACP message", line, e);
        }
      }
    }
  }

  private async handleMessage(msg: AcpMessage) {
    if (msg.id !== undefined) {
      if (msg.method) {
        // Request
        if (this.onRequest) {
          try {
            const result = await this.onRequest(msg.method, msg.params);
            this.send({ jsonrpc: "2.0", id: msg.id, result });
          } catch (error) {
            this.send({ jsonrpc: "2.0", id: msg.id, error });
          }
        }
      } else {
        // Response
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(msg.error);
          else pending.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      // Notification
      this.onNotification?.(msg.method, msg.params);
    }
  }

  private cleanupPending(err: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  // AI SDK V1 implementation
  toLanguageModel(): LanguageModel {
    const self = this;
    return {
      specificationVersion: "v1",
      provider: "claude-acp",
      modelId: this.command,
      doGenerate: async () => {
        throw new Error("doGenerate not implemented for ACP; use doStream");
      },
      doStream: async (options: any): Promise<any> => {
        await self.start();

        const prompt = options.prompt[options.prompt.length - 1];
        const content = typeof prompt === "string" ? prompt : (prompt as { content: string }).content;

        const stream = new ReadableStream({
          start(controller) {
            self.setHandlers({
              onNotification: (method, params) => {
                if (method === "agent/text") {
                  controller.enqueue({
                    type: "text-delta",
                    textDelta: params.text,
                  });
                }
              },
              onRequest: async () => {
                return null;
              },
            });

            void self.request("agent/chat", { text: content }).then(
              () => controller.close(),
              (err) => controller.error(err),
            );
          },
          cancel() {
            void self.stop();
          },
        });

        return {
          stream,
          rawCall: { rawPrompt: options.prompt, rawSettings: {} },
        };
      },
    } as unknown as LanguageModel;
  }
}
