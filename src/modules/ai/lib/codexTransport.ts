import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { getModel, type ModelId } from "../config";
import { codexChatStream } from "./codex";

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
          const messageId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `codex-${Date.now()}`;
          const openTextParts = new Set<string>();
          const openReasoningParts = new Set<string>();
          let closed = false;

          const cleanup = () => {
            abortSignal?.removeEventListener("abort", closeWithAbort);
          };

          const closeWithAbort = () => {
            if (closed) return;
            closed = true;
            cleanup();
            controller.enqueue({ type: "abort", reason: "aborted" });
            controller.close();
          };

          const closeWithError = (error: unknown) => {
            if (closed) return;
            closed = true;
            cleanup();
            controller.enqueue({
              type: "error",
              errorText: error instanceof Error ? error.message : String(error),
            });
            controller.close();
          };

          if (abortSignal?.aborted) {
            closeWithAbort();
            return;
          }
          abortSignal?.addEventListener("abort", closeWithAbort, {
            once: true,
          });

          try {
            controller.enqueue({ type: "start", messageId });
            controller.enqueue({ type: "start-step" });

            const model = getModel(deps.getModelId()).id;
            void codexChatStream(
              {
                prompt,
                cwd: deps.getCwd(),
                model,
              },
              (event) => {
                if (closed || abortSignal?.aborted) return;
                switch (event.kind) {
                  case "agentMessageStart": {
                    startTextPart(controller, openTextParts, event.itemId);
                    break;
                  }
                  case "agentMessageDelta": {
                    startTextPart(controller, openTextParts, event.itemId);
                    controller.enqueue({
                      type: "text-delta",
                      id: event.itemId,
                      delta: event.delta,
                    });
                    break;
                  }
                  case "agentMessageEnd": {
                    endTextPart(controller, openTextParts, event.itemId);
                    break;
                  }
                  case "reasoningStart": {
                    startReasoningPart(
                      controller,
                      openReasoningParts,
                      event.itemId,
                    );
                    break;
                  }
                  case "reasoningDelta": {
                    startReasoningPart(
                      controller,
                      openReasoningParts,
                      event.itemId,
                    );
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: event.itemId,
                      delta: event.delta,
                    });
                    break;
                  }
                  case "reasoningEnd": {
                    endReasoningPart(
                      controller,
                      openReasoningParts,
                      event.itemId,
                    );
                    break;
                  }
                  case "end": {
                    for (const id of [...openReasoningParts]) {
                      endReasoningPart(controller, openReasoningParts, id);
                    }
                    for (const id of [...openTextParts]) {
                      endTextPart(controller, openTextParts, id);
                    }
                    closed = true;
                    cleanup();
                    controller.enqueue({ type: "finish-step" });
                    controller.enqueue({ type: "finish", finishReason: "stop" });
                    controller.close();
                    break;
                  }
                  case "error": {
                    closeWithError(event.message);
                    break;
                  }
                }
              },
            ).catch(closeWithError);
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

function startTextPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  open: Set<string>,
  id: string,
) {
  if (open.has(id)) return;
  open.add(id);
  controller.enqueue({ type: "text-start", id });
}

function endTextPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  open: Set<string>,
  id: string,
) {
  if (!open.delete(id)) return;
  controller.enqueue({ type: "text-end", id });
}

function startReasoningPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  open: Set<string>,
  id: string,
) {
  if (open.has(id)) return;
  open.add(id);
  controller.enqueue({ type: "reasoning-start", id });
}

function endReasoningPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  open: Set<string>,
  id: string,
) {
  if (!open.delete(id)) return;
  controller.enqueue({ type: "reasoning-end", id });
}

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}
