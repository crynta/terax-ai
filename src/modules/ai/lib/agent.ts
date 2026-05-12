import {
  Experimental_Agent as Agent,
  DirectChatTransport,
  stepCountIs,
  type LanguageModel,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  getModel,
  LMSTUDIO_DEFAULT_BASE_URL,
  MAX_AGENT_STEPS,
  providerNeedsKey,
  SYSTEM_PROMPT,
  type ModelId,
  type ProviderId,
} from "../config";
import type { ProviderKeys } from "./keyring";
import { proxyFetch } from "./proxyFetch";
import { buildTools, type ToolContext } from "../tools/tools";

type AgentDeps = {
  keys: ProviderKeys;
  modelId?: ModelId;
  customInstructions?: string;
  /** Persona / role for this conversation (system prompt addendum). */
  agentPersona?: { name: string; instructions: string } | null;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
  /** Override base URL for OpenAI-compatible providers (LM Studio). */
  lmstudioBaseURL?: string;
  /** Concrete model id loaded in LM Studio (replaces the placeholder). */
  lmstudioModelId?: string;
  /** Base URL for the generic OpenAI-compatible provider. */
  openaiCompatibleBaseURL?: string;
  /** Concrete model id for the OpenAI-compatible endpoint. */
  openaiCompatibleModelId?: string;
  /** True when /plan is active — agent should batch edits for review. */
  planMode?: boolean;
  /** Contents of TERAX.md at workspace root, if present. Appended verbatim. */
  projectMemory?: string | null;
};

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  read_file: (i) => `Reading ${shortPath(i.path)}`,
  list_directory: (i) => `Listing ${shortPath(i.path)}`,
  grep: (i) => `Grepping ${ellipsize(String(i.pattern ?? ""), 40)}`,
  glob: (i) => `Globbing ${ellipsize(String(i.pattern ?? ""), 40)}`,
  edit: (i) => `Editing ${shortPath(i.path)}`,
  multi_edit: (i) => `Editing ${shortPath(i.path)}`,
  write_file: (i) => `Writing ${shortPath(i.path)}`,
  create_directory: (i) => `Creating ${shortPath(i.path)}`,
  bash_run: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
  bash_background: (i) =>
    `Spawning ${ellipsize(String(i.command ?? ""), 60)}`,
  bash_logs: () => `Reading logs`,
  bash_list: () => `Listing background processes`,
  bash_kill: () => `Stopping background process`,
  suggest_command: (i) =>
    `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
  todo_write: (i) =>
    `Updating plan (${Array.isArray(i.todos) ? i.todos.length : 0} items)`,
  run_subagent: (i) => `Spawning ${String(i.type ?? "subagent")} subagent`,
};

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type BuildModelOptions = {
  /** Override the model id (used by autocomplete with custom LM Studio model). */
  modelIdOverride?: string;
  /** Override LM Studio base URL. Defaults to `LMSTUDIO_DEFAULT_BASE_URL`. */
  lmstudioBaseURL?: string;
  /** Base URL for the generic OpenAI-compatible provider (user-supplied). */
  openaiCompatibleBaseURL?: string;
};

// Memoize built models. Provider clients are not free to construct — they
// register middleware and parse keys — and we'd otherwise rebuild one per
// `sendMessages` call. Keyed on the full identity that affects the result.
const modelCache = new Map<string, LanguageModel>();

export async function buildLanguageModel(
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
): Promise<LanguageModel> {
  if (providerNeedsKey(provider) && !keys[provider]) {
    throw new Error(
      `No API key configured for ${provider}. Open Settings → AI to add one.`,
    );
  }
  const key = keys[provider] ?? "";
  const lmstudioURL = options.lmstudioBaseURL ?? LMSTUDIO_DEFAULT_BASE_URL;
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const cacheKey = `${provider} ${key} ${resolvedModelId} ${lmstudioURL} ${compatURL}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;

  let built: LanguageModel;
  switch (provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      built = createOpenAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      built = createAnthropic({ apiKey: key })(resolvedModelId);
      break;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      built = createGoogleGenerativeAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      built = createXai({ apiKey: key })(resolvedModelId);
      break;
    }
    case "cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      built = createCerebras({ apiKey: key })(resolvedModelId);
      break;
    }
    case "deepseek": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      built = createGroq({ apiKey: key })(resolvedModelId);
      break;
    }
    case "openrouter": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        headers: {
          "HTTP-Referer": "https://terax.ai",
          "X-Title": "Terax",
        },
      })(resolvedModelId);
      break;
    }
    case "openai-compatible": {
      if (!compatURL) {
        throw new Error(
          "OpenAI-compatible provider has no base URL. Set it in Settings → Models.",
        );
      }
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: compatURL,
        apiKey: key || undefined,
        fetch: proxyFetch,
      })(resolvedModelId);
      break;
    }
    case "lmstudio": {
      const { createOpenAICompatible } = await import(
        "@ai-sdk/openai-compatible"
      );
      built = createOpenAICompatible({
        name: "lmstudio",
        baseURL: lmstudioURL,
        fetch: proxyFetch,
      })(resolvedModelId);
      break;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
  modelCache.set(cacheKey, built);
  return built;
}

function buildModel(
  modelId: ModelId,
  keys: ProviderKeys,
  lmstudioBaseURL?: string,
  lmstudioModelId?: string,
  openaiCompatibleBaseURL?: string,
  openaiCompatibleModelId?: string,
): Promise<LanguageModel> {
  const m = getModel(modelId);
  // Placeholder models route to a user-configured concrete id at runtime.
  let resolvedId: string = m.id;
  if (m.id === "lmstudio-local") {
    if (!lmstudioModelId?.trim()) {
      throw new Error(
        "LM Studio: no model id set. Open Settings → Models and enter the model id loaded in LM Studio.",
      );
    }
    resolvedId = lmstudioModelId.trim();
  } else if (m.id === "openai-compatible-custom") {
    if (!openaiCompatibleModelId?.trim()) {
      throw new Error(
        "OpenAI-compatible: no model id set. Open Settings → Models.",
      );
    }
    resolvedId = openaiCompatibleModelId.trim();
  }
  return buildLanguageModel(m.provider, keys, resolvedId, {
    lmstudioBaseURL,
    openaiCompatibleBaseURL,
  });
}

export async function createTeraxAgent({
  keys,
  modelId = DEFAULT_MODEL_ID,
  customInstructions,
  agentPersona,
  toolContext,
  onStep,
  lmstudioBaseURL,
  lmstudioModelId,
  openaiCompatibleBaseURL,
  openaiCompatibleModelId,
  planMode,
  projectMemory,
}: AgentDeps) {
  const trimmedCustom = customInstructions?.trim();
  const personaBlock = agentPersona?.instructions.trim()
    ? `\n\n## ACTIVE AGENT — ${agentPersona.name}\n${agentPersona.instructions.trim()}`
    : "";
  const customBlock = trimmedCustom
    ? `\n\n## USER CUSTOM INSTRUCTIONS — follow unless they conflict with safety rules above\n${trimmedCustom}`
    : "";
  const memoryBlock =
    projectMemory && projectMemory.trim().length > 0
      ? `\n\n## PROJECT — TERAX.md\n${projectMemory.trim()}`
      : "";
  const planBlock = planMode
    ? `\n\n## PLAN MODE — ACTIVE\nMutating tools (write_file, edit, multi_edit, create_directory) will queue their changes for the user to review as a single diff. Do NOT execute bash_run or bash_background while plan mode is active — restrict yourself to reads (read_file, grep, glob, list_directory) and the queued mutations. After queueing the full set of edits, stop and return a brief summary; do not continue acting until the user has accepted/rejected.`
    : "";
  const instructions = `${SYSTEM_PROMPT}${memoryBlock}${personaBlock}${customBlock}${planBlock}`;
  const model = await buildModel(
    modelId,
    keys,
    lmstudioBaseURL,
    lmstudioModelId,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
  );
  return new Agent({
    model,
    instructions,
    tools: buildTools(toolContext),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) {
        const label = TOOL_LABELS[last.toolName];
        onStep(
          label
            ? label((last.input ?? {}) as Record<string, unknown>)
            : `Calling ${last.toolName}`,
        );
      } else if (step.text) {
        onStep("Writing");
      }
    },
    onFinish: () => {
      onStep?.(null);
    },
  });
}

export type TeraxAgent = Awaited<ReturnType<typeof createTeraxAgent>>;

export function createTeraxTransport(agent: TeraxAgent) {
  return new DirectChatTransport({ agent });
}
