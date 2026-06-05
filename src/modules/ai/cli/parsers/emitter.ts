import type { UIMessageStreamWriter } from "ai";

/**
 * Thin helper over a `UIMessageStreamWriter` that tracks open text/reasoning
 * blocks and tool parts so parsers can emit well-formed chunk sequences
 * (start -> delta* -> end) without bookkeeping. One emitter per CLI run.
 */
export class ChunkEmitter {
  private seq = 0;
  private textId: string | null = null;
  private reasoningId: string | null = null;
  private readonly openTools = new Set<string>();

  constructor(private readonly writer: UIMessageStreamWriter) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  textDelta(delta: string): void {
    if (!delta) return;
    this.endReasoning();
    if (this.textId === null) {
      this.textId = this.id("txt");
      this.writer.write({ type: "text-start", id: this.textId });
    }
    this.writer.write({ type: "text-delta", id: this.textId, delta });
  }

  endText(): void {
    if (this.textId === null) return;
    this.writer.write({ type: "text-end", id: this.textId });
    this.textId = null;
  }

  reasoningDelta(delta: string): void {
    if (!delta) return;
    this.endText();
    if (this.reasoningId === null) {
      this.reasoningId = this.id("rsn");
      this.writer.write({ type: "reasoning-start", id: this.reasoningId });
    }
    this.writer.write({
      type: "reasoning-delta",
      id: this.reasoningId,
      delta,
    });
  }

  endReasoning(): void {
    if (this.reasoningId === null) return;
    this.writer.write({ type: "reasoning-end", id: this.reasoningId });
    this.reasoningId = null;
  }

  /** Emit a fully-resolved tool call the CLI executed on its own. */
  tool(toolCallId: string, toolName: string, input: unknown): void {
    this.endText();
    this.endReasoning();
    this.writer.write({
      type: "tool-input-available",
      toolCallId,
      toolName,
      input: input ?? {},
      providerExecuted: true,
      dynamic: true,
    });
    this.openTools.add(toolCallId);
  }

  toolResult(toolCallId: string, output: unknown): void {
    this.writer.write({
      type: "tool-output-available",
      toolCallId,
      output: output ?? null,
      providerExecuted: true,
      dynamic: true,
    });
    this.openTools.delete(toolCallId);
  }

  error(errorText: string): void {
    this.endText();
    this.endReasoning();
    this.writer.write({ type: "error", errorText });
  }

  /** Close any still-open blocks at end of run. */
  finish(): void {
    this.endText();
    this.endReasoning();
  }
}

export type CliParser = {
  onLine(line: string): void;
  onStderr?(line: string): void;
  onExit?(code: number | null): void;
};

export type ParserFactory = (emitter: ChunkEmitter) => CliParser;

/** Parse a JSONL line, returning null on blank/non-JSON noise. */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}
