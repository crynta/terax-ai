import { ChunkEmitter, parseJsonLine, type CliParser } from "./emitter";

/**
 * OpenCode `run --format json`. Each line is `{ type, part }` where `part` is a
 * message part keyed by `part.id`. Text and reasoning parts carry cumulative
 * text (emit the growing suffix); tool parts carry `state.status` with input
 * and output. Type strings appear in both dashed and underscored forms.
 */
export function createOpenCodeParser(emitter: ChunkEmitter): CliParser {
  const textSeen = new Map<string, number>();
  const reasoningSeen = new Map<string, number>();
  const toolStarted = new Set<string>();

  const onLine = (line: string) => {
    const obj = parseJsonLine(line);
    if (!obj) return;
    const type = String(obj.type ?? "").replace(/-/g, "_");
    const part = obj.part as Record<string, unknown> | undefined;

    if (type === "error") {
      emitter.error(String(obj.error ?? obj.message ?? "OpenCode run failed"));
      return;
    }
    if (!part) return;

    if (type === "text") {
      const id = String(part.id ?? "text");
      const full = String(part.text ?? "");
      emitter.textDelta(full.slice(textSeen.get(id) ?? 0));
      textSeen.set(id, full.length);
      return;
    }
    if (type === "reasoning") {
      const id = String(part.id ?? "reasoning");
      const full = String(part.text ?? "");
      emitter.reasoningDelta(full.slice(reasoningSeen.get(id) ?? 0));
      reasoningSeen.set(id, full.length);
      return;
    }
    if (type === "tool") {
      const id = String(part.callID ?? part.id ?? `tool-${toolStarted.size}`);
      const state = (part.state ?? {}) as Record<string, unknown>;
      const name = String(part.tool ?? "tool");
      if (!toolStarted.has(id)) {
        emitter.tool(id, name, state.input ?? {});
        toolStarted.add(id);
      }
      const status = state.status as string | undefined;
      if (status === "completed" || status === "error") {
        emitter.toolResult(id, state.output ?? state.error ?? null);
      }
    }
  };

  return { onLine };
}
