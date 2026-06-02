export const CODEX_REASONING_LEVELS = [
  { id: "low", label: "Low", requestValue: "low" },
  { id: "medium", label: "Medium", requestValue: "medium" },
  { id: "high", label: "High", requestValue: "high" },
  { id: "extra-high", label: "Extra High", requestValue: "xhigh" },
] as const;

export type CodexReasoning = (typeof CODEX_REASONING_LEVELS)[number]["id"];
export type CodexReasoningRequestValue =
  (typeof CODEX_REASONING_LEVELS)[number]["requestValue"];

export const DEFAULT_CODEX_REASONING: CodexReasoning = "medium";

export const CODEX_SPEED_OPTIONS = [
  {
    id: "standard",
    label: "Standard",
    description: "Default speed",
    requestValue: null,
  },
  {
    id: "fast",
    label: "Fast",
    description: "1.5x speed, increased usage",
    requestValue: "priority",
  },
] as const;

export type CodexSpeed = (typeof CODEX_SPEED_OPTIONS)[number]["id"];
export type CodexServiceTier = "priority";

export const DEFAULT_CODEX_SPEED: CodexSpeed = "standard";

export function normalizeCodexReasoning(value: unknown): CodexReasoning {
  return CODEX_REASONING_LEVELS.some((option) => option.id === value)
    ? (value as CodexReasoning)
    : DEFAULT_CODEX_REASONING;
}

export function normalizeCodexSpeed(value: unknown): CodexSpeed {
  return CODEX_SPEED_OPTIONS.some((option) => option.id === value)
    ? (value as CodexSpeed)
    : DEFAULT_CODEX_SPEED;
}

export function codexReasoningRequestValue(
  value: CodexReasoning | undefined,
): CodexReasoningRequestValue {
  const normalized = normalizeCodexReasoning(value);
  return (
    CODEX_REASONING_LEVELS.find((option) => option.id === normalized)
      ?.requestValue ?? "medium"
  );
}

export function codexServiceTier(
  value: CodexSpeed | undefined,
  modelWireId?: string,
): CodexServiceTier | undefined {
  if (normalizeCodexSpeed(value) !== "fast") return undefined;
  return codexModelSupportsFast(modelWireId) ? "priority" : undefined;
}

export function codexModelSupportsFast(modelWireId: string | undefined): boolean {
  return modelWireId === "gpt-5.5" || modelWireId === "gpt-5.4";
}

export function buildCodexProviderOptions(
  reasoning: CodexReasoning | undefined,
  speed: CodexSpeed | undefined,
  modelWireId?: string,
  instructions?: string,
  promptCacheKey?: string | null,
) {
  const serviceTier = codexServiceTier(speed, modelWireId);
  const cacheKey = promptCacheKey?.trim();
  return {
    openai: {
      store: false,
      reasoningEffort: codexReasoningRequestValue(reasoning),
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
      ...(instructions?.trim() ? { instructions } : {}),
      ...(cacheKey ? { promptCacheKey: cacheKey } : {}),
      ...(serviceTier ? { serviceTier } : {}),
    },
  };
}
