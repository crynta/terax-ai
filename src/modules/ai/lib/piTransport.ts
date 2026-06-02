import { invoke, Channel } from "@tauri-apps/api/core";
import type { UIMessage } from "@ai-sdk/react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { parsePiModelId } from "../config";

type LiveSnapshot = {
  cwd: string | null;
  terminalPrivate: boolean;
  workspaceRoot: string | null;
  activeFile: string | null;
};

type Deps = {
  getModelId: () => string;
  getPiExecutablePath: () => string;
  getLive: () => LiveSnapshot;
  getCustomInstructions: () => string;
  onStep?: (step: string | null) => void;
};

type SendOptions = {
  chatId: string;
  messages: UIMessage[];
  abortSignal?: AbortSignal;
};

type PiRunEvent =
  | { kind: "line"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "end"; exitCode?: number | null; exit_code?: number | null; success?: boolean }
  | { kind: "error"; message: string };

type PiStreamState = {
  textIndex: number;
  activeTextId: string | null;
  toolInputs: Map<string, { toolName: string; input: unknown }>;
  reasoningIds: Set<string>;
  syntheticToolIndex: number;
};

export function createPiTransport(deps: Deps): ChatTransport<UIMessage> {
  return {
    sendMessages: (options) => sendPiMessages(deps, options),
    async reconnectToStream(): Promise<null> {
      return null;
    },
  };
}

function sendPiMessages(
  deps: Deps,
  options: SendOptions,
): Promise<ReadableStream<UIMessageChunk>> {
  const parsed = parsePiModelId(deps.getModelId());
  if (!parsed) {
    throw new Error("Pi transport received a non-Pi model id.");
  }
  const prompt = buildPrompt(options.messages, deps);
  if (!prompt.trim()) {
    throw new Error("No prompt text to send to Pi.");
  }

  let runId: string | null = null;
  let finished = false;
  let sawText = false;
  const stderr: string[] = [];
  const streamState: PiStreamState = {
    textIndex: 0,
    activeTextId: null,
    toolInputs: new Map(),
    reasoningIds: new Set(),
    syntheticToolIndex: 0,
  };

  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "start-step" });

      const channel = new Channel<PiRunEvent>();
      channel.onmessage = (event) => {
        if (finished) return;
        switch (event.kind) {
          case "line":
            handlePiJsonLine(event.line, controller, streamState, (delta) => {
              sawText = sawText || delta.length > 0;
            }, deps);
            break;
          case "stderr":
            if (event.line.trim()) stderr.push(event.line);
            break;
          case "error":
            finished = true;
            controller.error(new Error(event.message));
            break;
          case "end":
            finished = true;
            deps.onStep?.(null);
            {
              const exitCode = event.exitCode ?? event.exit_code ?? null;
              const success = event.success ?? exitCode === 0;
              if (!success) {
                const message = stderr.join("\n").trim() || `Pi exited with code ${exitCode ?? "unknown"}.`;
                controller.error(new Error(message));
                return;
              }
            }
            if (!sawText) {
              controller.error(new Error("Pi completed without streaming assistant text."));
              return;
            }
            closeOpenReasoningParts(controller, streamState);
            closeOpenTextPart(controller, streamState);
            controller.enqueue({ type: "finish-step" });
            controller.enqueue({ type: "finish" });
            controller.close();
            break;
        }
      };

      const abort = () => {
        finished = true;
        deps.onStep?.(null);
        if (runId) void invoke("pi_cancel", { runId });
        controller.error(new DOMException("Request aborted", "AbortError"));
      };
      options.abortSignal?.addEventListener("abort", abort, { once: true });

      void invoke<string>("pi_run", {
        executablePath: deps.getPiExecutablePath() || null,
        cwd: deps.getLive().cwd ?? deps.getLive().workspaceRoot,
        sessionId: piSessionIdForChat(options.chatId),
        model: `${parsed.provider}/${parsed.model}`,
        prompt,
        workspace: currentWorkspaceEnv(),
        onEvent: channel,
      })
        .then((id) => {
          runId = id;
          if (options.abortSignal?.aborted) abort();
        })
        .catch((e) => {
          finished = true;
          controller.error(e instanceof Error ? e : new Error(String(e)));
        });
    },
    cancel() {
      finished = true;
      deps.onStep?.(null);
      if (runId) void invoke("pi_cancel", { runId });
    },
  });

  return Promise.resolve(stream);
}

function handlePiJsonLine(
  line: string,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
  markText: (delta: string) => void,
  deps: Deps,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  const rec = event as Record<string, unknown>;
  if (rec.type === "message_update") {
    const message = rec.message as Record<string, unknown> | undefined;
    const update = rec.assistantMessageEvent as Record<string, unknown> | undefined;
    const updateType = typeof update?.type === "string" ? update.type : "";
    if (
      message?.role === "assistant" &&
      updateType === "text_delta" &&
      typeof update?.delta === "string"
    ) {
      const delta = update.delta;
      markText(delta);
      const textId = ensureTextPart(controller, state);
      controller.enqueue({
        type: "text-delta",
        id: textId,
        delta,
      });
      return;
    }
    if (
      message?.role === "assistant" &&
      (updateType === "thinking_start" || updateType === "reasoning_start")
    ) {
      deps.onStep?.("Pi is thinking");
      ensureReasoningPart(controller, state, piReasoningId(update));
      return;
    }
    if (
      message?.role === "assistant" &&
      (updateType === "thinking_delta" || updateType === "reasoning_delta") &&
      typeof update?.delta === "string"
    ) {
      const delta = update.delta;
      deps.onStep?.("Pi is thinking");
      const id = piReasoningId(update);
      ensureReasoningPart(controller, state, id);
      controller.enqueue({ type: "reasoning-delta", id, delta });
      return;
    }
    if (
      message?.role === "assistant" &&
      (updateType === "thinking_end" || updateType === "reasoning_end")
    ) {
      const id = piReasoningId(update);
      if (state.reasoningIds.has(id)) {
        controller.enqueue({ type: "reasoning-end", id });
        state.reasoningIds.delete(id);
      }
    }
    return;
  }
  if (rec.type === "tool_execution_start" && typeof rec.toolName === "string") {
    const toolCallId = piToolCallId(rec, state, true);
    if (!toolCallId) return;
    const toolName = sanitizePiToolName(rec.toolName);
    ensureToolInput(controller, state, toolCallId, toolName, compactPiValue(rec.args));
    deps.onStep?.(`Pi: ${toolName}`);
    return;
  }
  if (rec.type === "tool_execution_update" && typeof rec.toolName === "string") {
    const toolCallId = piToolCallId(rec, state, false);
    if (!toolCallId) return;
    const toolName = sanitizePiToolName(rec.toolName);
    ensureToolInput(controller, state, toolCallId, toolName, compactPiValue(rec.args));
    controller.enqueue({
      type: "tool-output-available",
      toolCallId,
      output: compactPiValue(rec.partialResult),
      dynamic: true,
      providerExecuted: true,
      preliminary: true,
    });
    deps.onStep?.(`Pi: ${toolName}`);
    return;
  }
  if (rec.type === "tool_execution_end") {
    const toolCallId = piToolCallId(rec, state, false);
    if (toolCallId) {
      const toolName =
        typeof rec.toolName === "string" ? sanitizePiToolName(rec.toolName) : "tool";
      ensureToolInput(controller, state, toolCallId, toolName, compactPiValue(rec.args));
      if (rec.isError) {
        controller.enqueue({
          type: "tool-output-error",
          toolCallId,
          errorText: compactPiError(rec.result),
          dynamic: true,
          providerExecuted: true,
        });
      } else {
        controller.enqueue({
          type: "tool-output-available",
          toolCallId,
          output: compactPiValue(rec.result),
          dynamic: true,
          providerExecuted: true,
        });
      }
    }
    deps.onStep?.("Pi tool finished");
    return;
  }
  if (rec.type === "agent_start" || rec.type === "turn_start") {
    deps.onStep?.("Pi is working");
  }
}

function ensureTextPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
): string {
  closeOpenReasoningParts(controller, state);
  if (state.activeTextId) return state.activeTextId;
  state.textIndex += 1;
  const id = `pi-text-${state.textIndex}`;
  state.activeTextId = id;
  controller.enqueue({ type: "text-start", id });
  return id;
}

function closeOpenTextPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
): void {
  if (!state.activeTextId) return;
  controller.enqueue({ type: "text-end", id: state.activeTextId });
  state.activeTextId = null;
}

function ensureToolInput(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
  toolCallId: string,
  toolName: string,
  input: unknown,
): void {
  closeOpenReasoningParts(controller, state);
  closeOpenTextPart(controller, state);
  if (state.toolInputs.has(toolCallId)) return;
  state.toolInputs.set(toolCallId, { toolName, input });
  controller.enqueue({
    type: "tool-input-available",
    toolCallId,
    toolName,
    input,
    dynamic: true,
    providerExecuted: true,
    title: `Pi: ${toolName}`,
  });
}

function ensureReasoningPart(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
  id: string,
): void {
  if (state.reasoningIds.has(id)) return;
  closeOpenTextPart(controller, state);
  state.reasoningIds.add(id);
  controller.enqueue({ type: "reasoning-start", id });
}

function closeOpenReasoningParts(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: PiStreamState,
): void {
  for (const id of state.reasoningIds) {
    controller.enqueue({ type: "reasoning-end", id });
  }
  state.reasoningIds.clear();
}

function piReasoningId(update: Record<string, unknown> | undefined): string {
  const index = update?.contentIndex ?? update?.content_index ?? 0;
  return `pi-reasoning-${typeof index === "number" ? index : 0}`;
}

function piToolCallId(
  rec: Record<string, unknown>,
  state: PiStreamState,
  allowSynthetic: boolean,
): string | null {
  if (typeof rec.toolCallId === "string" && rec.toolCallId.trim()) {
    return rec.toolCallId;
  }
  if (!allowSynthetic) return null;
  state.syntheticToolIndex += 1;
  return `pi-tool-${state.syntheticToolIndex}`;
}

function sanitizePiToolName(name: string): string {
  return name.trim().replace(/\s+/g, "_") || "tool";
}

function compactPiError(value: unknown): string {
  const compact = compactPiValue(value);
  return typeof compact === "string" ? compact : JSON.stringify(compact);
}

function compactPiValue(value: unknown): unknown {
  const maxLength = 4000;
  if (typeof value === "string") {
    return value.length > maxLength
      ? `${value.slice(0, maxLength)}\n\n...[truncated]`
      : value;
  }
  if (value == null || typeof value !== "object") return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxLength) return value;
    return `${json.slice(0, maxLength)}\n\n...[truncated]`;
  } catch {
    return String(value);
  }
}

function buildPrompt(messages: UIMessage[], deps: Deps): string {
  const latest = latestUserText(messages);
  const live = deps.getLive();
  const blocks: string[] = [];
  const envLines: string[] = [];
  if (live.workspaceRoot) envLines.push(`workspace_root: ${live.workspaceRoot}`);
  if (live.cwd) envLines.push(`active_terminal_cwd: ${live.cwd}`);
  if (live.activeFile) envLines.push(`active_file: ${live.activeFile}`);
  if (live.terminalPrivate) envLines.push("active_terminal_mode: private");
  if (envLines.length > 0) blocks.push(`<env>\n${envLines.join("\n")}\n</env>`);
  const instructions = deps.getCustomInstructions().trim();
  if (instructions) {
    blocks.push(`<terax-custom-instructions>\n${instructions}\n</terax-custom-instructions>`);
  }
  blocks.push(latest);
  return blocks.filter(Boolean).join("\n\n");
}

function latestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const text = msg.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function piSessionIdForChat(chatId: string): string {
  const cleaned = chatId
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  return `terax-${cleaned || "chat"}`;
}
