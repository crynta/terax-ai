import { Experimental_Agent as Agent, stepCountIs } from "ai";
import { DEFAULT_MODEL_ID, getModel, type ModelId } from "../config";
import { buildLanguageModel } from "../lib/agent";
import type { ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildFsTools } from "../tools/fs";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  modelId: ModelId;
  toolContext: ToolContext;
  lmstudioBaseURL?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
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
  openaiCompatibleBaseURL,
  openaiCompatibleModelId,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  // Subagents only get read-only tools. Build directly from the read-only
  // builders to avoid pulling in mutating/recursive tools.
  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
  };
  const filtered: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) filtered[t] = readOnly[t];
  }

  const model = await buildLanguageModel(getModel(modelId).provider, keys, getModel(modelId).id, {
    lmstudioBaseURL,
    openaiCompatibleBaseURL,
    openaiCompatibleModelId,
  });

  // The Agent constructor's tools generic infers `never` when passed a
  // dynamic record, so cast through unknown for both `tools` and
  // `stopWhen` (whose StopCondition is parameterized by the same generic).
  const agent = new Agent({
    model,
    instructions: def.systemPrompt,
    tools: filtered,
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS) as never,
  } as never);

  const start = Date.now();
  const result = await (agent as unknown as {
    generate: (a: { prompt: string }) => Promise<unknown>;
  }).generate({ prompt });
  const durationMs = Date.now() - start;

  // Best-effort summary extraction across SDK shape variations.
  const r = result as unknown as {
    text?: string;
    response?: { messages?: { content?: unknown }[] };
    steps?: unknown[];
  };
  const summary = r.text ?? extractText(r) ?? "(no output)";
  const stepCount = Array.isArray(r.steps) ? r.steps.length : 0;

  return { summary, stepCount, durationMs };
}

function extractText(r: {
  response?: { messages?: { content?: unknown }[] };
}): string | null {
  const msgs = r.response?.messages;
  if (!Array.isArray(msgs)) return null;
  const parts: string[] = [];
  for (const m of msgs) {
    if (typeof m.content === "string") parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content as { type?: string; text?: string }[]) {
        if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
      }
    }
  }
  return parts.join("\n").trim() || null;
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
