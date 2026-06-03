import type { UIMessage } from "@ai-sdk/react";
import {
  createUIMessageStream,
  type ChatTransport,
  type UIMessageChunk,
} from "ai";
import {
  codexModelSlug,
  DEFAULT_CODEX_MODEL_ID,
  isCodexModelId as isConfiguredCodexModelId,
} from "../config";
import { native, type CodexStreamEvent } from "./native";

type LiveSnapshot = {
  cwd: string | null;
  terminalPrivate: boolean;
  workspaceRoot: string | null;
  activeFile: string | null;
};

type CodexTransportOptions = {
  messages: UIMessage[];
  originalMessages?: UIMessage[];
  live: LiveSnapshot;
  projectMemory: string | null;
  customInstructions: string;
  agentPersona: { name: string; instructions: string } | null;
  planMode: boolean;
  modelId?: string;
  abortSignal?: AbortSignal;
  onStep?: (step: string | null) => void;
};

export function isCodexModelId(modelId: string): boolean {
  return isConfiguredCodexModelId(modelId);
}

export function runCodexAppServerStream({
  messages,
  originalMessages,
  live,
  projectMemory,
  customInstructions,
  agentPersona,
  planMode,
  modelId,
  abortSignal,
  onStep,
}: CodexTransportOptions): Promise<ReadableStream<UIMessageChunk>> {
  const prompt = buildConversationPrompt(messages);
  const developerInstructions = buildDeveloperInstructions({
    projectMemory,
    customInstructions,
    agentPersona,
    planMode,
  });
  const cwd = live.cwd ?? live.workspaceRoot;
  const codexModel = codexModelSlug(modelId ?? DEFAULT_CODEX_MODEL_ID);

  return Promise.resolve(
    createUIMessageStream<UIMessage>({
      originalMessages: originalMessages ?? messages,
      async execute({ writer }) {
        if (abortSignal?.aborted) {
          writer.write({ type: "abort", reason: "aborted" });
          return;
        }
        onStep?.("Starting Codex");
        const openTextIds = new Set<string>();
        const openReasoningIds = new Set<string>();
        let finished = false;
        let aborted = false;
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });

        const closeOpenParts = () => {
          for (const id of openTextIds) {
            writer.write({ type: "text-end", id });
          }
          openTextIds.clear();
          for (const id of openReasoningIds) {
            writer.write({ type: "reasoning-end", id });
          }
          openReasoningIds.clear();
        };

        const handleEvent = (event: CodexStreamEvent) => {
          if (aborted || finished) return;
          switch (event.kind) {
            case "step": {
              onStep?.(event.label);
              break;
            }
            case "textStart": {
              if (!openTextIds.has(event.id)) {
                openTextIds.add(event.id);
                writer.write({ type: "text-start", id: event.id });
              }
              break;
            }
            case "textDelta": {
              if (!openTextIds.has(event.id)) {
                openTextIds.add(event.id);
                writer.write({ type: "text-start", id: event.id });
              }
              writer.write({
                type: "text-delta",
                id: event.id,
                delta: event.delta,
              });
              break;
            }
            case "textEnd": {
              if (openTextIds.delete(event.id)) {
                writer.write({ type: "text-end", id: event.id });
              }
              break;
            }
            case "reasoningStart": {
              if (!openReasoningIds.has(event.id)) {
                openReasoningIds.add(event.id);
                writer.write({ type: "reasoning-start", id: event.id });
              }
              break;
            }
            case "reasoningDelta": {
              if (!openReasoningIds.has(event.id)) {
                openReasoningIds.add(event.id);
                writer.write({ type: "reasoning-start", id: event.id });
              }
              writer.write({
                type: "reasoning-delta",
                id: event.id,
                delta: event.delta,
              });
              break;
            }
            case "reasoningEnd": {
              if (openReasoningIds.delete(event.id)) {
                writer.write({ type: "reasoning-end", id: event.id });
              }
              break;
            }
            case "error": {
              finished = true;
              closeOpenParts();
              writer.write({ type: "error", errorText: event.message });
              writer.write({ type: "finish-step" });
              writer.write({ type: "finish", finishReason: "error" });
              break;
            }
            case "done": {
              finished = true;
              closeOpenParts();
              writer.write({ type: "finish-step" });
              writer.write({ type: "finish", finishReason: "stop" });
              break;
            }
          }
        };

        let abortHandler: (() => void) | null = null;
        const abortPromise = new Promise<"aborted">((resolve) => {
          if (abortSignal) {
            abortHandler = () => {
              aborted = true;
              resolve("aborted");
            };
            abortSignal.addEventListener("abort", abortHandler, { once: true });
          }
        });

        try {
          const streamPromise = native.codexAppServerStream(
            {
              prompt,
              cwd,
              model: codexModel,
              developerInstructions,
            },
            handleEvent,
          );
          streamPromise.catch(() => {});
          const outcome = await Promise.race([streamPromise, abortPromise]);
          if (outcome === "aborted") {
            closeOpenParts();
            writer.write({ type: "abort", reason: "aborted" });
            return;
          }
          if (!finished) {
            finished = true;
            closeOpenParts();
            writer.write({ type: "finish-step" });
            writer.write({ type: "finish", finishReason: "stop" });
          }
        } catch (error) {
          if (finished) return;
          finished = true;
          closeOpenParts();
          writer.write({
            type: "error",
            errorText: codexErrorMessage(error),
          });
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "error" });
        } finally {
          if (abortHandler) {
            abortSignal?.removeEventListener("abort", abortHandler);
          }
          onStep?.(null);
        }
      },
      onError(error) {
        return codexErrorMessage(error);
      },
    }) as ReadableStream<UIMessageChunk>,
  );
}

export function createCodexTransport(
  getOptions: () => Omit<CodexTransportOptions, "messages" | "abortSignal">,
): ChatTransport<UIMessage> {
  return {
    sendMessages({ messages, abortSignal }) {
      return runCodexAppServerStream({
        ...getOptions(),
        messages,
        abortSignal,
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

function buildDeveloperInstructions({
  projectMemory,
  customInstructions,
  agentPersona,
  planMode,
}: Pick<
  CodexTransportOptions,
  "projectMemory" | "customInstructions" | "agentPersona" | "planMode"
>): string {
  const sections = [
    "You are running inside Terax's internal AI agent panel. Reply through the panel, not a terminal. Match the user's language unless they ask otherwise.",
  ];
  if (projectMemory?.trim()) {
    sections.push(`## Project TERAX.md\n${projectMemory.trim()}`);
  }
  if (agentPersona?.instructions.trim()) {
    sections.push(
      `## Active Agent - ${agentPersona.name}\n${agentPersona.instructions.trim()}`,
    );
  }
  if (customInstructions.trim()) {
    sections.push(`## User Custom Instructions\n${customInstructions.trim()}`);
  }
  if (planMode) {
    sections.push(
      "## Plan Mode\nPlan mode is active. Do not make file changes; return a concise plan or analysis.",
    );
  }
  return sections.join("\n\n");
}

function buildConversationPrompt(messages: UIMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = messageText(message).trim();
    if (!text) continue;
    const role =
      message.role === "assistant"
        ? "Assistant"
        : message.role === "system"
          ? "System"
          : "User";
    lines.push(`${role}:\n${text}`);
  }
  return lines.length > 0 ? lines.join("\n\n") : "Continue the conversation.";
}

function messageText(message: UIMessage): string {
  const parts = (message.parts ?? []) as ReadonlyArray<{
    type: string;
    text?: string;
    mediaType?: string;
    filename?: string;
  }>;
  const out: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      out.push(part.text);
    } else if (part.type === "file") {
      out.push(
        `[attached file omitted: ${part.filename ?? part.mediaType ?? "file"}]`,
      );
    } else if (part.type === "reasoning" && part.text) {
      out.push(`[reasoning summary]\n${part.text}`);
    }
  }
  return out.join("\n");
}

function codexErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/not logged in|login|auth/i.test(raw)) {
    return `${raw}\n\nOpen Settings -> Models -> Codex and sign in with ChatGPT.`;
  }
  return raw;
}
