/**
 * Minimax (and other OpenAI-compatible reasoning models) often interleave
 * `reasoning_content` with `content` in the stream. The AI SDK closes the
 * current reasoning part on every text delta, so one assistant turn becomes
 * many `type: "reasoning"` parts  -  some after the answer text (#1012).
 *
 * Display-only: merge every reasoning part into a single block and hoist it
 * before the rest. Stored message history is left intact so providers that
 * need reasoning in multi-turn context still receive it.
 */
export type CoalesceablePart = {
  type: string;
  text?: string;
  state?: string;
  providerMetadata?: unknown;
  [key: string]: unknown;
};

export function coalesceReasoningParts<T extends CoalesceablePart>(
  parts: readonly T[],
): T[] {
  const reasoningIdxs: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.type === "reasoning") reasoningIdxs.push(i);
  }
  if (reasoningIdxs.length === 0) return parts as T[];

  // Already a single leading reasoning part  -  nothing to fix.
  if (reasoningIdxs.length === 1 && reasoningIdxs[0] === 0) {
    return parts as T[];
  }

  const texts: string[] = [];
  let state: string | undefined;
  let providerMetadata: unknown;
  let sawStreaming = false;

  for (const i of reasoningIdxs) {
    const p = parts[i]!;
    const text = typeof p.text === "string" ? p.text : "";
    if (text.length > 0) texts.push(text);
    if (p.state === "streaming") sawStreaming = true;
    else if (state === undefined && typeof p.state === "string") state = p.state;
    if (providerMetadata === undefined && p.providerMetadata !== undefined) {
      providerMetadata = p.providerMetadata;
    }
  }

  const first = parts[reasoningIdxs[0]!]!;
  const merged = {
    ...first,
    type: "reasoning",
    text: texts.join("\n\n"),
    ...(sawStreaming
      ? { state: "streaming" }
      : state !== undefined
        ? { state }
        : {}),
    ...(providerMetadata !== undefined ? { providerMetadata } : {}),
  } as T;

  const rest: T[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]?.type === "reasoning") continue;
    rest.push(parts[i]!);
  }

  // Drop an empty merged reasoning block (all empty texts).
  if (merged.text === "" && !sawStreaming) return rest;
  return [merged, ...rest];
}
