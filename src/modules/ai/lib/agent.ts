import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import {
  Experimental_Agent as Agent,
  DirectChatTransport,
  stepCountIs,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  getModel,
  MAX_AGENT_STEPS,
  SYSTEM_PROMPT,
  type ModelId,
  type ProviderId,
} from "../config";
import type { ProviderKeys } from "./keyring";
import { buildTools, type ToolContext } from "../tools/tools";

type AgentDeps = {
  keys: ProviderKeys;
  modelId?: ModelId;
  customInstructions?: string;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
};

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  read_file: (i) => `Reading ${shortPath(i.path)}`,
  list_directory: (i) => `Listing ${shortPath(i.path)}`,
  write_file: (i) => `Writing ${shortPath(i.path)}`,
  create_directory: (i) => `Creating ${shortPath(i.path)}`,
  run_command: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
  suggest_command: (i) =>
    `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
};

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildModel(modelId: ModelId, keys: ProviderKeys) {
  const m = getModel(modelId);
  const key = keys[m.provider];
  if (!key) {
    throw new Error(`No API key configured for ${m.provider}. Open Settings → AI to add one.`);
  }
  switch (m.provider) {
    case "openai":
      return createOpenAI({ apiKey: key })(m.id);
    case "anthropic":
      return createAnthropic({ apiKey: key })(m.id);
    case "google":
      return createGoogleGenerativeAI({ apiKey: key })(m.id);
    case "xai":
      return createXai({ apiKey: key })(m.id);
    default: {
      const _exhaustive: never = m.provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
}

export function createTeraxAgent({
  keys,
  modelId = DEFAULT_MODEL_ID,
  customInstructions,
  toolContext,
  onStep,
}: AgentDeps) {
  const trimmed = customInstructions?.trim();
  const instructions = trimmed
    ? `${SYSTEM_PROMPT}\n\nUSER CUSTOM INSTRUCTIONS — follow these unless they conflict with safety rules above:\n${trimmed}`
    : SYSTEM_PROMPT;
  return new Agent({
    model: buildModel(modelId, keys),
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

export type TeraxAgent = ReturnType<typeof createTeraxAgent>;

export function createTeraxTransport(agent: TeraxAgent) {
  return new DirectChatTransport({ agent });
}
