import { generateText, stepCountIs } from "ai";
import {
  DEFAULT_MODEL_ID,
  getModel,
  isCompatModelId,
  type CustomEndpoint,
  type ModelId,
} from "../config";
import { buildConfiguredLanguageModel, buildLanguageModel } from "../lib/agent";
import type { CustomEndpointKeys, ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildFsTools } from "../tools/fs";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: string;
  toolContext: ToolContext;
  lmstudioBaseURL?: string;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
  onStep?: (label: string) => void;
};

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
};

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  lmstudioBaseURL,
  customEndpoints,
  customEndpointKeys,
  onStep,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
  };
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) tools[t] = readOnly[t];
  }

  // Custom-endpoint (compat-*) models aren't in MODELS, so getModel would throw.
  // Resolve them via the shared compat-aware builder (endpoint baseURL + key).
  const model = isCompatModelId(modelId)
    ? await buildConfiguredLanguageModel(modelId, keys, {
        customEndpoints,
        customEndpointKeys,
      })
    : await buildLanguageModel(
        getModel(modelId as ModelId).provider,
        keys,
        getModel(modelId as ModelId).id,
        { lmstudioBaseURL },
      );

  const start = Date.now();
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
