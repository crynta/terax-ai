/**
 * Deterministic mock LLM provider for end-to-end tests (Phase C, Stage 0).
 *
 * The chat surface only does anything with a live BYOK provider (keys +
 * network), which the e2e harness deliberately excludes. This module supplies a
 * fake `LanguageModelV3` that streams a canned reply with no key and no network,
 * so the composer -> transport -> store -> transcript path can be regression
 * tested. It is only ever reached when the `terax.e2e` localStorage flag is set
 * (see `mockFlags.ts`); `buildConfiguredLanguageModel` gates on that flag and
 * `import()`s this module lazily, so the mock + `ai/test` never enter the
 * production main chunk.
 */
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";

/** The canned assistant reply, used by specs to assert the stream rendered. */
export const MOCK_REPLY = "Mock reply: hello from the e2e provider.";

const MOCK_USAGE = {
  inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 8, text: 8, reasoning: 0 },
};

/**
 * Build the mock language model. Streams `MOCK_REPLY` word by word so the
 * surface exercises real streaming (not a single chunk), then finishes.
 */
export async function buildMockModel(modelId: string): Promise<LanguageModel> {
  const { MockLanguageModelV3, convertArrayToReadableStream } = await import(
    "ai/test"
  );

  const textId = "txt-0";
  const words = MOCK_REPLY.split(" ");
  const parts: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: textId },
    ...words.map((word, index) => ({
      type: "text-delta" as const,
      id: textId,
      delta: index === 0 ? word : ` ${word}`,
    })),
    { type: "text-end", id: textId },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: MOCK_USAGE,
    },
  ];

  return new MockLanguageModelV3({
    modelId,
    doStream: async () => ({
      stream: convertArrayToReadableStream(parts),
    }),
  });
}
