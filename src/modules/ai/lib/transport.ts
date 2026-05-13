import type { UIMessage } from "@ai-sdk/react";
import { TERMINAL_BUFFER_LINES, type ModelId } from "../config";
import { runAgentStream, type AgentUsage } from "./agent";
import type { ProviderKeys } from "./keyring";
import { native } from "./native";
import type { ToolContext } from "../tools/tools";

const TERAX_MD_MAX_BYTES = 32 * 1024;
type MemoryCacheEntry = { content: string | null; mtime: number };
const projectMemoryCache = new Map<string, MemoryCacheEntry>();

async function readTeraxMd(workspaceRoot: string | null): Promise<string | null> {
  if (!workspaceRoot) return null;
  const path = `${workspaceRoot.replace(/\/$/, "")}/TERAX.md`;
  const cached = projectMemoryCache.get(workspaceRoot);
  if (cached && Date.now() - cached.mtime < 30_000) return cached.content;
  try {
    const r = await native.readFile(path);
    if (r.kind !== "text") {
      projectMemoryCache.set(workspaceRoot, { content: null, mtime: Date.now() });
      return null;
    }
    const content =
      r.content.length > TERAX_MD_MAX_BYTES
        ? r.content.slice(0, TERAX_MD_MAX_BYTES)
        : r.content;
    projectMemoryCache.set(workspaceRoot, { content, mtime: Date.now() });
    return content;
  } catch {
    projectMemoryCache.set(workspaceRoot, { content: null, mtime: Date.now() });
    return null;
  }
}

type LiveSnapshot = {
  cwd: string | null;
  terminal: string | null;
  terminalPrivate: boolean;
  workspaceRoot: string | null;
  activeFile: string | null;
};

const MAX_TERMINAL_CHARS = 4_000;

type Deps = {
  getKeys: () => ProviderKeys;
  toolContext: ToolContext;
  getModelId: () => ModelId;
  getCustomInstructions: () => string;
  getAgentPersona: () => { name: string; instructions: string } | null;
  getLive: () => LiveSnapshot;
  getLmstudioBaseURL?: () => string | undefined;
  getLmstudioModelId?: () => string | undefined;
  getOpenaiCompatibleBaseURL?: () => string | undefined;
  getOpenaiCompatibleModelId?: () => string | undefined;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsage) => void;
  getPlanMode?: () => boolean;
};

type SendOptions = {
  messages: UIMessage[];
  abortSignal?: AbortSignal;
  [k: string]: unknown;
};

export function createContextAwareTransport(deps: Deps) {
  const run = async (options: SendOptions) => {
    const live = deps.getLive();
    const projectMemory = await readTeraxMd(live.workspaceRoot);
    const envBlock = formatEnvBlock(live);
    const result = await runAgentStream({
      keys: deps.getKeys(),
      modelId: deps.getModelId(),
      customInstructions: deps.getCustomInstructions(),
      agentPersona: deps.getAgentPersona(),
      toolContext: deps.toolContext,
      onStep: deps.onStep,
      onUsage: deps.onUsage,
      lmstudioBaseURL: deps.getLmstudioBaseURL?.(),
      lmstudioModelId: deps.getLmstudioModelId?.(),
      openaiCompatibleBaseURL: deps.getOpenaiCompatibleBaseURL?.(),
      openaiCompatibleModelId: deps.getOpenaiCompatibleModelId?.(),
      planMode: deps.getPlanMode?.(),
      projectMemory,
      envBlock,
      uiMessages: options.messages,
      abortSignal: options.abortSignal,
    });
    return result.toUIMessageStream({
      originalMessages: options.messages,
    });
  };

  return {
    sendMessages: run,
    async reconnectToStream(): Promise<null> {
      return null;
    },
  };
}

function formatEnvBlock(live: LiveSnapshot): string | null {
  const lines: string[] = [];
  if (live.workspaceRoot) lines.push(`workspace_root: ${live.workspaceRoot}`);
  if (live.cwd) lines.push(`active_terminal_cwd: ${live.cwd}`);
  if (live.activeFile) lines.push(`active_file: ${live.activeFile}`);
  if (live.terminalPrivate) {
    lines.push("active_terminal_mode: private");
    lines.push(
      "recent_terminal_output: (hidden — user enabled Privacy mode; do not ask for the buffer)",
    );
  } else if (live.terminal) {
    const trimmed = capChars(
      lastNLines(live.terminal, TERMINAL_BUFFER_LINES),
      MAX_TERMINAL_CHARS,
    );
    lines.push("recent_terminal_output:");
    lines.push("```");
    lines.push(trimmed);
    lines.push("```");
  }
  if (lines.length === 0) return null;
  return `<env>\n${lines.join("\n")}\n</env>`;
}

function lastNLines(s: string, n: number): string {
  const all = s.split("\n");
  return all.length <= n ? s : all.slice(all.length - n).join("\n");
}

function capChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return `…[truncated ${s.length - max} chars]…\n${s.slice(s.length - max)}`;
}

export const CONTEXT_BLOCK_RE =
  /^<terminal-context[^>]*>[\s\S]*?<\/terminal-context>\n*/;

export function stripContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, "");
}
