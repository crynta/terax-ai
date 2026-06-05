import { ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

/**
 * cursor-agent `--output-format stream-json --stream-partial-output`.
 * Shape mirrors Claude's stream-json but coarser: `assistant` events carry the
 * cumulative message content (text grows across events); tool calls surface as
 * `tool_call` content blocks; `result` carries terminal status.
 */
export function createCursorParser(emitter: ChunkEmitter): CliParser {
  let emittedText = "";
  const toolStarted = new Set<string>();

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    const type = obj.type as string | undefined;

    if (type === "assistant") {
      const content = (obj.message as Record<string, unknown> | undefined)?.content;
      if (Array.isArray(content)) for (const block of content) handleBlock(block);
      return;
    }
    if (type === "result" && obj.is_error === true) {
      emitter.error(
        typeof obj.result === "string" ? obj.result : "cursor-agent run failed",
      );
    }
  };

  function handleBlock(block: unknown): void {
    if (!block || typeof block !== "object") return;
    const b = block as Record<string, unknown>;
    const btype = b.type as string | undefined;

    if (btype === "text") {
      const text = String(b.text ?? "");
      if (text === emittedText) return;
      if (text.startsWith(emittedText)) {
        emitter.textDelta(text.slice(emittedText.length));
      } else {
        emitter.textDelta(text);
      }
      emittedText = text;
      return;
    }
    if (btype === "thinking" || btype === "reasoning") {
      emitter.reasoningDelta(String(b.text ?? b.thinking ?? ""));
      return;
    }
    if (btype === "tool_call" || btype === "tool_use") {
      const id = String(b.id ?? b.tool_call_id ?? `tool-${toolStarted.size}`);
      if (!toolStarted.has(id)) {
        emitter.tool(id, String(b.name ?? b.tool ?? "tool"), b.input ?? b.arguments ?? {});
        toolStarted.add(id);
      }
      if (b.result !== undefined || b.output !== undefined) {
        emitter.toolResult(id, b.result ?? b.output);
      }
    }
  }

  return { onLine };
}
