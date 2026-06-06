import { stepCountIs, streamText as aiStreamText, type LanguageModel } from "ai";
import { estimateCost } from "@/modules/ai/config";
import {
  buildConfiguredLanguageModel,
  type LocalProviderConfig,
} from "@/modules/ai/lib/agent";
import type {
  CustomEndpointKeys,
  ProviderKeys,
} from "@/modules/ai/lib/keyring";
import { native } from "@/modules/ai/lib/native";
import { buildFsTools } from "@/modules/ai/tools/fs";
import { buildSearchTools } from "@/modules/ai/tools/search";
import { resolvePath, type ToolContext } from "@/modules/ai/tools/tools";
import type { ComparePaneMetrics, ModelCompareMode } from "./modelCompare";

const COMPARE_SYSTEM_PROMPT = `You are participating in a fair model comparison inside Terax.
Answer the user's prompt directly and completely.
Do not mention that this is a benchmark unless the user asks.
Do not use tools or claim to have external context.`;

const AGENT_COMPARE_SYSTEM_PROMPT = `You are participating in a read-only agent comparison inside Terax.
You may inspect the workspace with read-only tools only: read_file, list_directory, grep, and glob.
Never write files, edit files, run shell commands, spawn subagents, or claim you used tools that were not provided.
Work independently from the other panes and return a concise agent-style result with findings, plan, risks, and next actions.`;

const AGENT_COMPARE_MAX_STEPS = 8;

type UsageLike = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  inputTokenDetails?: { cacheReadTokens?: number | null } | null;
  promptTokenDetails?: { cachedTokens?: number | null } | null;
};

type StreamTextLike = (args: {
  model: LanguageModel | unknown;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  tools?: Record<string, unknown>;
  stopWhen?: unknown;
}) => {
  textStream: AsyncIterable<string>;
  usage?: PromiseLike<UsageLike> | UsageLike;
};

type BuildModelLike = (
  modelId: string,
  keys: ProviderKeys,
  local: LocalProviderConfig,
) => Promise<LanguageModel | unknown>;

const defaultStreamText: StreamTextLike = (args) =>
  aiStreamText({ ...args, model: args.model as LanguageModel } as Parameters<
    typeof aiStreamText
  >[0]);

export type ModelCompareAgentContext = {
  activeCwd?: string | null;
  workspaceRoot?: string | null;
  terminalContext?: string | null;
};

export type RunModelComparePaneInput = {
  prompt: string;
  mode?: ModelCompareMode;
  modelId: string;
  keys: ProviderKeys | Partial<ProviderKeys>;
  local: LocalProviderConfig;
  agentContext?: ModelCompareAgentContext;
  abortSignal?: AbortSignal;
  now?: () => number;
  onDelta?: (delta: string) => void;
  buildModel?: BuildModelLike;
  streamText?: StreamTextLike;
};

export type RunModelComparePaneResult = {
  response: string;
  metrics: ComparePaneMetrics;
};

export type ModelCompareProbeResult = {
  modelId: string;
  status: "ok" | "failed";
  latencyMs: number | null;
  response: string;
  error: string | null;
};

export type ProbeModelCompareModelInput = Omit<
  RunModelComparePaneInput,
  "prompt" | "onDelta"
> & {
  prompt?: string;
};

const MODEL_COMPARE_PROBE_PROMPT = "Reply with exactly OK.";

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type ExecutableTool = {
  execute?: (input: Record<string, unknown>, options?: unknown) => unknown;
};

function comparablePath(path: string): string {
  let next = path.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  if (next.length > 1 && next.endsWith("/")) next = next.slice(0, -1);
  return next;
}

export function agentComparePathWithinRoot(path: string, root: string): boolean {
  const target = comparablePath(path);
  const scope = comparablePath(root);
  return target === scope || target.startsWith(`${scope}/`);
}

function agentCompareScopeRoot(
  context: ModelCompareAgentContext,
): string | null {
  return context.workspaceRoot?.trim() || context.activeCwd?.trim() || null;
}

async function verifyAgentComparePathScope(
  rawPath: string | undefined,
  context: ModelCompareAgentContext,
): Promise<{ ok: true } | { ok: false; error: Record<string, string> }> {
  const root = agentCompareScopeRoot(context);
  if (!root) {
    return {
      ok: false,
      error: {
        error:
          "Agent Compare read-only tools require a workspace root or active cwd.",
      },
    };
  }
  try {
    const target = resolvePath(
      rawPath?.trim() || root,
      context.activeCwd?.trim() || root,
    );
    const [canonicalRoot, canonicalTarget] = await Promise.all([
      native.canonicalize(root),
      native.canonicalize(target),
    ]);
    if (!agentComparePathWithinRoot(canonicalTarget, canonicalRoot)) {
      return {
        ok: false,
        error: {
          error:
            "Refused: Agent Compare read-only tools are scoped to the current workspace.",
          path: canonicalTarget,
          workspaceRoot: canonicalRoot,
        },
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: {
        error: error instanceof Error ? error.message : String(error),
        path: rawPath ?? root,
      },
    };
  }
}

function scopeAgentCompareTool(
  tool: unknown,
  context: ModelCompareAgentContext,
  pathField: "path" | "root",
): unknown {
  const executable = tool as ExecutableTool;
  if (typeof executable.execute !== "function") return tool;
  const execute = executable.execute.bind(tool);
  return {
    ...(tool as Record<string, unknown>),
    execute: async (input: Record<string, unknown>, options?: unknown) => {
      const rawPath =
        typeof input[pathField] === "string"
          ? (input[pathField] as string)
          : undefined;
      const scope = await verifyAgentComparePathScope(rawPath, context);
      if (!scope.ok) return scope.error;
      return execute(input, options);
    },
  };
}

export function buildReadOnlyAgentTools(
  context: ModelCompareAgentContext | undefined,
): Record<string, unknown> | undefined {
  if (!context?.workspaceRoot && !context?.activeCwd) return undefined;
  const toolContext: ToolContext = {
    getCwd: () => context.activeCwd?.trim() || agentCompareScopeRoot(context),
    getWorkspaceRoot: () => context.workspaceRoot?.trim() || null,
    getTerminalContext: () => context.terminalContext ?? null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => null,
  };
  const fsTools = buildFsTools(toolContext);
  const searchTools = buildSearchTools(toolContext);
  return {
    read_file: scopeAgentCompareTool(fsTools.read_file, context, "path"),
    list_directory: scopeAgentCompareTool(
      fsTools.list_directory,
      context,
      "path",
    ),
    grep: scopeAgentCompareTool(searchTools.grep, context, "root"),
    glob: scopeAgentCompareTool(searchTools.glob, context, "root"),
  };
}

function buildAgentComparePrompt(
  prompt: string,
  context: ModelCompareAgentContext | undefined,
): string {
  const lines = [
    "Agent task:",
    prompt,
    "",
    "Workspace context:",
    `- workspaceRoot: ${context?.workspaceRoot ?? "not provided"}`,
    `- activeCwd: ${context?.activeCwd ?? "not provided"}`,
  ];
  const terminalContext = context?.terminalContext?.trim();
  if (terminalContext) {
    lines.push("- active terminal tail:", terminalContext);
  }
  lines.push(
    "",
    "Use read-only workspace tools when helpful. If no workspace context is available, answer from the prompt only and say so.",
  );
  return lines.join("\n");
}

export async function runModelComparePane({
  prompt,
  mode = "models",
  modelId,
  keys,
  local,
  agentContext,
  abortSignal,
  now = () => Date.now(),
  onDelta,
  buildModel = buildConfiguredLanguageModel,
  streamText = defaultStreamText,
}: RunModelComparePaneInput): Promise<RunModelComparePaneResult> {
  const startedAt = now();
  const model = await buildModel(modelId, keys as ProviderKeys, local);
  const agentMode = mode === "agent";
  const stream = streamText({
    model,
    system: agentMode ? AGENT_COMPARE_SYSTEM_PROMPT : COMPARE_SYSTEM_PROMPT,
    prompt: agentMode ? buildAgentComparePrompt(prompt, agentContext) : prompt,
    abortSignal,
    tools: agentMode ? buildReadOnlyAgentTools(agentContext) : undefined,
    stopWhen: agentMode ? stepCountIs(AGENT_COMPARE_MAX_STEPS) : undefined,
  });

  let response = "";
  for await (const delta of stream.textStream) {
    response += delta;
    onDelta?.(delta);
  }

  const usage = stream.usage ? await stream.usage : {};
  const completedAt = now();
  const inputTokens = numberValue(usage.inputTokens ?? usage.promptTokens);
  const outputTokens = numberValue(
    usage.outputTokens ?? usage.completionTokens,
  );
  const cachedInputTokens = numberValue(
    usage.inputTokenDetails?.cacheReadTokens ??
      usage.promptTokenDetails?.cachedTokens,
  );
  const costUsd = estimateCost(modelId, {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  });

  return {
    response,
    metrics: {
      startedAt,
      completedAt,
      latencyMs: Math.max(0, completedAt - startedAt),
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costUsd,
    },
  };
}

export async function probeModelCompareModel({
  prompt = MODEL_COMPARE_PROBE_PROMPT,
  ...input
}: ProbeModelCompareModelInput): Promise<ModelCompareProbeResult> {
  try {
    const result = await runModelComparePane({
      ...input,
      prompt,
    });
    return {
      modelId: input.modelId,
      status: "ok",
      latencyMs: result.metrics.latencyMs,
      response: result.response,
      error: null,
    };
  } catch (error) {
    return {
      modelId: input.modelId,
      status: "failed",
      latencyMs: null,
      response: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildCompareLocalConfig(input: {
  lmstudioBaseURL?: string;
  lmstudioModelId?: string;
  mlxBaseURL?: string;
  mlxModelId?: string;
  ollamaBaseURL?: string;
  ollamaModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleContextLimit?: number;
  openrouterModelId?: string;
  customEndpoints?: LocalProviderConfig["customEndpoints"];
  customEndpointKeys?: CustomEndpointKeys;
}): LocalProviderConfig {
  return {
    lmstudioBaseURL: input.lmstudioBaseURL,
    lmstudioModelId: input.lmstudioModelId,
    mlxBaseURL: input.mlxBaseURL,
    mlxModelId: input.mlxModelId,
    ollamaBaseURL: input.ollamaBaseURL,
    ollamaModelId: input.ollamaModelId,
    openaiCompatibleBaseURL: input.openaiCompatibleBaseURL,
    openaiCompatibleModelId: input.openaiCompatibleModelId,
    openrouterModelId: input.openrouterModelId,
    customEndpoints: input.customEndpoints,
    customEndpointKeys: input.customEndpointKeys,
  };
}
