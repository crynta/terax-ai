import type { ProviderId } from "../config";

export type DetectedProvider = {
  provider: ProviderId;
  confidence: number;
};

const PREFIX_PATTERNS: [RegExp, ProviderId, number][] = [
  [/^gpt-/, "openai", 0.99],
  [/^o[13]-/, "openai", 0.99],
  [/^o[13]\d?/, "openai", 0.95],
  [/^chatgpt-/, "openai", 0.99],
  [/^ft:gpt-/, "openai", 0.99],
  [/^claude-/, "anthropic", 0.99],
  [/^gemini-/, "google", 0.99],
  [/^gemma-/, "google", 0.9],
  [/^grok-/, "xai", 0.99],
  [/^deepseek-/, "deepseek", 0.99],
  [/^mistral-|^codestral-|^mixtral-|^pixtral-/, "mistral", 0.99],
  [/^open-mistral-|^open-mixtral-/, "mistral", 0.99],
  [/^command-/, "cohere", 0.99],
  [/^embed-|^rerank-/, "cohere", 0.85],
  [/^sonar/, "perplexity", 0.99],
  [/^moonshot-|^kimi-/, "moonshot", 0.99],
  [/^glm-/, "zhipu", 0.99],
  [/^doubao-/, "volcengine", 0.99],
  [/^yi-/, "yi", 0.99],
  [/^MiniMax-/, "minimax", 0.99],
  [/^llama-|^llama3\.?\d?/, "openai-compatible", 0.5],
  [/^qwen/, "openai-compatible", 0.5],
];

const SLASH_PREFIX: [string, ProviderId, number][] = [
  ["openai/", "openrouter", 0.5],
  ["anthropic/", "openrouter", 0.5],
  ["google/", "openrouter", 0.5],
  ["x-ai/", "openrouter", 0.5],
  ["deepseek/", "openrouter", 0.5],
  ["meta-llama/", "openrouter", 0.5],
  ["mistralai/", "openrouter", 0.5],
  ["moonshotai/", "openrouter", 0.5],
  ["qwen/", "openrouter", 0.5],
  ["z-ai/", "openrouter", 0.5],
  ["nousresearch/", "openrouter", 0.5],
  ["microsoft/", "openrouter", 0.5],
];

export function detectFromModelId(modelId: string): DetectedProvider {
  const lower = modelId.toLowerCase();

  for (const [pattern, provider, confidence] of PREFIX_PATTERNS) {
    if (pattern.test(lower)) {
      return { provider, confidence };
    }
  }

  for (const [prefix, provider, confidence] of SLASH_PREFIX) {
    if (lower.startsWith(prefix)) {
      return { provider, confidence };
    }
  }

  if (lower.includes("/") && !lower.startsWith("http")) {
    return { provider: "openrouter", confidence: 0.3 };
  }

  return { provider: "openai-compatible", confidence: 0.1 };
}

export function detectFromUrl(url: string): DetectedProvider | null {
  const u = url.toLowerCase();
  const patterns: [string, ProviderId, number][] = [
    ["api.openai.com", "openai", 0.99],
    ["api.anthropic.com", "anthropic", 0.99],
    ["generativelanguage.googleapis.com", "google", 0.99],
    ["api.x.ai", "xai", 0.99],
    ["api.deepseek.com", "deepseek", 0.99],
    ["api.mistral.ai", "mistral", 0.99],
    ["openrouter.ai", "openrouter", 0.99],
    ["api.together.xyz", "together", 0.99],
    ["api.fireworks.ai", "fireworks", 0.99],
    ["api.perplexity.ai", "perplexity", 0.99],
    ["api.cohere.com", "cohere", 0.99],
    ["api.moonshot.cn", "moonshot", 0.99],
    ["api.siliconflow.cn", "siliconflow", 0.99],
    ["api.hyperbolic.xyz", "hyperbolic", 0.99],
    ["api.deepinfra.com", "deepinfra", 0.99],
    ["api.novita.ai", "novita", 0.99],
    ["router.huggingface.co", "huggingface", 0.99],
    ["endpoints.huggingface.cloud", "huggingface-endpoint", 0.99],
    ["endpoints.huggingface.co", "huggingface-endpoint", 0.99],
    ["api.sambanova.ai", "sambanova", 0.99],
    ["api.minimax.io", "minimax", 0.99],
    ["open.bigmodel.cn", "zhipu", 0.99],
    ["api.z.ai", "zhipu", 0.99],
    ["ark.cn-beijing.volces.com", "volcengine", 0.99],
    ["api.01.ai", "yi", 0.99],
    ["api.replicate.com", "replicate", 0.99],
    ["localhost:11434", "ollama", 0.99],
    ["localhost:1234", "lmstudio", 0.99],
    ["cerebras.ai", "cerebras", 0.99],
    ["api.groq.com", "groq", 0.99],
  ];

  for (const [domain, provider, confidence] of patterns) {
    if (u.includes(domain)) {
      return { provider, confidence };
    }
  }

  return null;
}

export function detectFromResponse(body: string): DetectedProvider | null {
  try {
    const json = JSON.parse(body);
    const model: string | undefined = json?.model ?? json?.response?.model;
    if (typeof model !== "string") return null;
    return detectFromModelId(model);
  } catch {
    return null;
  }
}
