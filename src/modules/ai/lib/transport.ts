import type { UIMessage } from "@ai-sdk/react";
import { DirectChatTransport } from "ai";
import { TERMINAL_BUFFER_LINES, type ModelId } from "../config";
import { createTeraxAgent } from "./agent";
import type { ProviderKeys } from "./keyring";
import type { ToolContext } from "../tools/tools";

type LiveSnapshot = {
  cwd: string | null;
  terminal: string | null;
  workspaceRoot: string | null;
  activeFile: string | null;
};

const MAX_TERMINAL_CHARS = 12_000;

type Deps = {
  getKeys: () => ProviderKeys;
  toolContext: ToolContext;
  getModelId: () => ModelId;
  getCustomInstructions: () => string;
  getLive: () => LiveSnapshot;
  onStep?: (step: string | null) => void;
};

export function createContextAwareTransport(deps: Deps) {
  return {
    async sendMessages(options: {
      messages: UIMessage[];
      [k: string]: unknown;
    }) {
      const agent = createTeraxAgent({
        keys: deps.getKeys(),
        modelId: deps.getModelId(),
        customInstructions: deps.getCustomInstructions(),
        toolContext: deps.toolContext,
        onStep: deps.onStep,
      });
      const base = new DirectChatTransport({ agent });
      const augmented = injectContext(options.messages, deps.getLive());
      return base.sendMessages({
        ...options,
        messages: augmented,
      } as Parameters<typeof base.sendMessages>[0]);
    },
    async reconnectToStream(options: unknown) {
      const agent = createTeraxAgent({
        keys: deps.getKeys(),
        modelId: deps.getModelId(),
        customInstructions: deps.getCustomInstructions(),
        toolContext: deps.toolContext,
        onStep: deps.onStep,
      });
      const base = new DirectChatTransport({ agent });
      type ReconnectArg = Parameters<typeof base.reconnectToStream>[0];
      return base.reconnectToStream(options as ReconnectArg);
    },
  };
}

function injectContext(messages: UIMessage[], live: LiveSnapshot): UIMessage[] {
  if (!live.cwd && !live.terminal && !live.workspaceRoot) return messages;
  const lastUserIdx = lastIndex(messages, (m) => m.role === "user");
  if (lastUserIdx === -1) return messages;

  const block = formatContextBlock(live);
  return messages.map((m, i) => {
    if (i !== lastUserIdx) return m;
    const contextPart = { type: "text" as const, text: block };
    return {
      ...m,
      parts: [contextPart, ...m.parts] as UIMessage["parts"],
    };
  });
}

function formatContextBlock(live: LiveSnapshot): string {
  const lines = [
    '<terminal-context note="auto-injected, read-only">',
    `workspace_root: ${live.workspaceRoot ?? "(unknown)"}`,
    `active_terminal_cwd: ${live.cwd ?? "(unknown)"}`,
  ];
  if (live.activeFile) lines.push(`active_file: ${live.activeFile}`);
  if (live.terminal) {
    const trimmed = capChars(
      lastNLines(live.terminal, TERMINAL_BUFFER_LINES),
      MAX_TERMINAL_CHARS,
    );
    lines.push("recent_terminal_output:");
    lines.push("```");
    lines.push(trimmed);
    lines.push("```");
  }
  lines.push("</terminal-context>");
  lines.push("");
  return lines.join("\n");
}

function lastNLines(s: string, n: number): string {
  const all = s.split("\n");
  return all.length <= n ? s : all.slice(all.length - n).join("\n");
}

function capChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return `…[truncated ${s.length - max} chars]…\n${s.slice(s.length - max)}`;
}

function lastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

export const CONTEXT_BLOCK_RE =
  /^<terminal-context[^>]*>[\s\S]*?<\/terminal-context>\n*/;

export function stripContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK_RE, "");
}
