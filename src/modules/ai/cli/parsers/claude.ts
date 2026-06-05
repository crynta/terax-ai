import { ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

type Block = { kind: string; id: string; name: string; json: string };

/**
 * Claude Code `--output-format stream-json --include-partial-messages`.
 * Text and thinking stream as Anthropic SSE deltas inside `stream_event`;
 * tool calls are assembled from `content_block_*` and finalized on stop;
 * tool results arrive as `user` messages; `result` carries terminal status.
 */
export function createClaudeParser(emitter: ChunkEmitter): CliParser {
  const blocks = new Map<number, Block>();

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    const type = obj.type as string | undefined;

    if (type === "stream_event") {
      handleStreamEvent(obj.event as Record<string, unknown> | undefined);
      return;
    }
    if (type === "user") {
      handleToolResults(obj.message as Record<string, unknown> | undefined);
      return;
    }
    if (type === "result" && obj.is_error === true) {
      const msg =
        typeof obj.result === "string" ? obj.result : "Claude run failed";
      emitter.error(msg);
    }
  };

  function handleStreamEvent(event?: Record<string, unknown>): void {
    if (!event) return;
    const etype = event.type as string | undefined;
    switch (etype) {
      case "content_block_start": {
        const index = event.index as number;
        const cb = (event.content_block ?? {}) as Record<string, unknown>;
        blocks.set(index, {
          kind: (cb.type as string) ?? "text",
          id: (cb.id as string) ?? `tool-${index}`,
          name: (cb.name as string) ?? "tool",
          json: "",
        });
        break;
      }
      case "content_block_delta": {
        const index = event.index as number;
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        const dtype = delta.type as string | undefined;
        if (dtype === "text_delta") emitter.textDelta(String(delta.text ?? ""));
        else if (dtype === "thinking_delta")
          emitter.reasoningDelta(String(delta.thinking ?? ""));
        else if (dtype === "input_json_delta") {
          const b = blocks.get(index);
          if (b) b.json += String(delta.partial_json ?? "");
        }
        break;
      }
      case "content_block_stop": {
        const index = event.index as number;
        const b = blocks.get(index);
        if (b && b.kind === "tool_use") {
          let input: unknown = {};
          try {
            input = b.json ? JSON.parse(b.json) : {};
          } catch {
            input = { _raw: b.json };
          }
          emitter.tool(b.id, b.name, input);
        }
        blocks.delete(index);
        break;
      }
    }
  }

  function handleToolResults(message?: Record<string, unknown>): void {
    const content = message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block && block.type === "tool_result") {
        emitter.toolResult(block.tool_use_id, normalizeContent(block.content));
      }
    }
  }

  return { onLine };
}

function normalizeContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: unknown }).text)
          : JSON.stringify(c),
      )
      .join("\n");
  }
  return content ?? null;
}
