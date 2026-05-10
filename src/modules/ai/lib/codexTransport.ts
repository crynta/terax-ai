import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { getModel, type ModelId } from "../config";
import { codexChatOnce } from "./codex";

type Deps = {
  getCwd: () => string | null;
  getModelId: () => ModelId;
};

export function createCodexChatTransport(deps: Deps): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const prompt = lastUserText(messages);
      if (!prompt.trim()) {
        throw new Error("Codex prompt is empty.");
      }

      return new ReadableStream<UIMessageChunk>({
        async start(controller) {
          const textId = `codex-text-${Date.now()}`;
          const messageId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `codex-${Date.now()}`;

          const closeWithError = (error: unknown) => {
            controller.enqueue({
              type: "error",
              errorText: error instanceof Error ? error.message : String(error),
            });
            controller.close();
          };

          if (abortSignal?.aborted) {
            controller.enqueue({ type: "abort", reason: "aborted" });
            controller.close();
            return;
          }

          try {
            controller.enqueue({ type: "start", messageId });
            controller.enqueue({ type: "start-step" });
            controller.enqueue({ type: "text-start", id: textId });

            const model = getModel(deps.getModelId()).id;
            const answer = await codexChatOnce({
              prompt,
              cwd: deps.getCwd(),
              model,
            });

            if (abortSignal?.aborted) {
              controller.enqueue({ type: "abort", reason: "aborted" });
              controller.close();
              return;
            }

            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: answer || "(Codex returned no text.)",
            });
            controller.enqueue({ type: "text-end", id: textId });
            controller.enqueue({ type: "finish-step" });
            controller.enqueue({ type: "finish", finishReason: "stop" });
            controller.close();
          } catch (error) {
            closeWithError(error);
          }
        },
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}
