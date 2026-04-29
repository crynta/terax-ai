import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  LMSTUDIO_DEFAULT_BASE_URL,
  type AutocompleteProviderId,
} from "@/modules/ai/config";
import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { generateText } from "ai";
import {
  buildUserPrompt,
  COMPLETION_SYSTEM_PROMPT,
  type CompletionRequest,
} from "./prompt";

export type CompletionDeps = {
  provider: AutocompleteProviderId;
  modelId: string;
  /** API key for the configured provider, or null for keyless (LM Studio). */
  apiKey: string | null;
  lmstudioBaseURL: string;
};

const MAX_OUTPUT_TOKENS_DEFAULT = 128;
// Reasoning models burn output tokens on internal thought before producing
// any visible content; with a tight cap they finish_reason="length" with
// empty text. The trim step still caps visible output at MAX_LINES.
const MAX_OUTPUT_TOKENS_REASONING = 1024;

export async function requestCompletion(
  req: CompletionRequest,
  deps: CompletionDeps,
  signal: AbortSignal,
): Promise<string> {
  const modelId =
    deps.modelId.trim() || DEFAULT_AUTOCOMPLETE_MODEL[deps.provider];
  const keys = { ...EMPTY_PROVIDER_KEYS, [deps.provider]: deps.apiKey };
  const model = buildLanguageModel(deps.provider, keys, modelId, {
    lmstudioBaseURL: deps.lmstudioBaseURL || LMSTUDIO_DEFAULT_BASE_URL,
  });

  const isReasoning = /\bgpt-oss\b/i.test(modelId);
  const providerOptions = isReasoning
    ? {
        cerebras: { reasoningEffort: "low" },
        groq: { reasoningEffort: "low" },
        openai: { reasoningEffort: "low" },
      }
    : undefined;

  const { text } = await generateText({
    model,
    system: COMPLETION_SYSTEM_PROMPT,
    prompt: buildUserPrompt(req),
    maxOutputTokens: isReasoning
      ? MAX_OUTPUT_TOKENS_REASONING
      : MAX_OUTPUT_TOKENS_DEFAULT,
    maxRetries: 0,
    abortSignal: signal,
    temperature: 0.2,
    ...(providerOptions ? { providerOptions } : {}),
  });

  return cleanCompletion(text);
}

function cleanCompletion(raw: string): string {
  let t = raw;
  const fence = t.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```\s*$/);
  if (fence) t = fence[1];
  t = t.replace(/^<\|cursor\|>/, "");
  return t;
}
