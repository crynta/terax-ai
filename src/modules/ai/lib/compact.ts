import type { ModelMessage } from "ai";

const KEEP_TAIL = 8;
const ELISION_TEXT = "[elided to save context — see prior tool call in history]";

function approxBytes(messages: ModelMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === "string") n += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content as { type: string; [k: string]: unknown }[]) {
        if (part.type === "text" && typeof part.text === "string") n += part.text.length;
        else if (part.type === "tool-result") n += JSON.stringify(part.output ?? "").length;
        else if (part.type === "tool-call") n += JSON.stringify(part.input ?? "").length;
        else n += 64;
      }
    }
  }
  return n;
}

function elideToolResults(m: ModelMessage): ModelMessage {
  if (m.role !== "tool" || !Array.isArray(m.content)) return m;
  type ToolPart = { type: string; output?: unknown; [k: string]: unknown };
  let touched = false;
  const next = (m.content as ToolPart[]).map((part) => {
    if (part.type !== "tool-result") return part;
    if (
      part.output &&
      typeof part.output === "object" &&
      (part.output as { __elided?: boolean }).__elided
    ) {
      return part;
    }
    touched = true;
    return {
      ...part,
      output: { type: "text", value: ELISION_TEXT, __elided: true },
    };
  });
  if (!touched) return m;
  return { ...m, content: next } as ModelMessage;
}

/** Replace older tool-result outputs with a stub when the conversation
 *  approaches the model's context limit. Keeps the last KEEP_TAIL messages
 *  intact and never touches system messages. */
export function compactModelMessages(
  messages: ModelMessage[],
  contextLimit: number,
): ModelMessage[] {
  const approxTokens = approxBytes(messages) / 4;
  if (approxTokens < 0.7 * contextLimit) return messages;

  const out = messages.slice();
  const stopIdx = Math.max(0, out.length - KEEP_TAIL);
  for (let i = 0; i < stopIdx; i++) {
    if (out[i].role === "system") continue;
    out[i] = elideToolResults(out[i]);
    if (approxBytes(out) / 4 < 0.6 * contextLimit) break;
  }
  return out;
}
