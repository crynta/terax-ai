/**
 * Pi SDK Webview Bridge — Agent Session Factory
 *
 * Creates Pi SDK Agent instances that run entirely in the webview,
 * using Tauri IPC for file/shell operations and LLM API calls.
 *
 * This replaces the Node.js sidecar (sidecars/pi-host/).
 */

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";
import {
  Agent,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  generateSummary,
  shouldCompact,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  getModel,
  type Model,
  streamSimple,
  type TSchema,
  Type,
} from "@earendil-works/pi-ai";
import { formatQuestionAnswers } from "@/modules/pi/lib/question-registry";
import type {
  PiQuestionAnswer,
  PiQuestionOption,
} from "@/modules/pi/lib/sessions";
import { piEnv } from "./pi-env";
import { installProxiedFetch, uninstallProxiedFetch } from "./pi-http";
import { piBridgeTools } from "./pi-tools";

// ─── Types ───

export type TauriAgentOptions = {
  /** Working directory for file/shell operations */
  cwd: string;
  /** System prompt */
  systemPrompt?: string;
  /** Provider name (e.g. "anthropic", "openai") */
  provider: string;
  /** Model ID within the provider (e.g. "claude-sonnet-4-20250514") */
  modelId: string;
  /** Optional base URL override */
  baseUrl?: string;
  /** Initial thinking level */
  thinkingLevel?: string;
  /**
   * Approval gate for tool execution.
   * If provided, called before each tool execution.
   * Return true to approve, false to deny.
   * The gate may emit events and wait for user response.
   */
  approvalGate?: (
    toolName: string,
    toolCallId: string,
    input: unknown,
  ) => Promise<boolean>;
  /**
   * Question gate for interactive elicitation. When provided, an `ask_question`
   * tool is exposed; calling it emits a question to the UI and blocks until the
   * user answers, returning their selection(s).
   */
  questionGate?: (
    toolCallId: string,
    params: {
      question: string;
      options: PiQuestionOption[];
      allowMultiple: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<PiQuestionAnswer[]>;
};

// ─── Tool helpers ───

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: undefined as unknown,
  };
}

function errorResult(error: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${error}` }],
    details: undefined as unknown,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolExecute = AgentTool<any>["execute"];

// ─── Tool factory ───

function createAgentTools(cwd: string): AgentTool[] {
  return [
    {
      name: "read_file",
      label: "Read file",
      description: "Read a file's contents.",
      parameters: Type.Object({
        path: Type.String({ description: "File path" }),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { path } = params as { path: string };
        try {
          const result = await piBridgeTools.readFile(path, cwd);
          return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "write_file",
      label: "Write file",
      description: "Write content to a file.",
      parameters: Type.Object({
        path: Type.String(),
        content: Type.String(),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { path, content } = params as { path: string; content: string };
        try {
          const result = await piBridgeTools.writeFile(path, content, cwd);
          return textResult(JSON.stringify(result));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "edit_file",
      label: "Edit file",
      description:
        "Apply exact text replacements to a file. Each edit's oldText must be unique in the file.",
      parameters: Type.Object({
        path: Type.String({ description: "File path" }),
        edits: Type.Array(
          Type.Object({
            oldText: Type.String({ description: "Exact text to find" }),
            newText: Type.String({ description: "Replacement text" }),
          }),
        ),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { path, edits } = params as {
          path: string;
          edits: Array<{ oldText: string; newText: string }>;
        };
        try {
          const result = await piBridgeTools.editFile(path, edits, cwd);
          return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "list_directory",
      label: "List directory",
      description: "List entries in a directory.",
      parameters: Type.Object({
        path: Type.String(),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { path } = params as { path: string };
        try {
          const result = await piBridgeTools.listDirectory(path, cwd);
          return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "bash_run",
      label: "Run command",
      description:
        "Run a shell command and return stdout, stderr, and exit code.",
      parameters: Type.Object({
        command: Type.String(),
      }),
      execute: (async (_id: string, params: unknown, signal?: AbortSignal) => {
        const { command } = params as { command: string };
        if (signal?.aborted) throw new Error("Aborted");
        try {
          const result = await piBridgeTools.bash(command, cwd);
          if (signal?.aborted) throw new Error("Aborted");
          const output = result.stdout || result.stderr || "(no output)";
          return textResult(
            `${output}\n\nexit code: ${result.exitCode ?? "unknown"}`,
          );
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "grep",
      label: "Search files",
      description: "Search file contents with a regex pattern.",
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.String({ description: "Root directory to search" }),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { pattern, path } = params as { pattern: string; path: string };
        try {
          const result = await piBridgeTools.grep(pattern, path);
          return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
    {
      name: "glob",
      label: "Find files",
      description: "Find files matching a glob pattern.",
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.String({ description: "Root directory to search" }),
      }),
      execute: (async (_id: string, params: unknown) => {
        const { pattern, path } = params as { pattern: string; path: string };
        try {
          const result = await piBridgeTools.glob(pattern, path);
          return textResult(JSON.stringify(result, null, 2));
        } catch (e) {
          return errorResult(String(e));
        }
      }) as ToolExecute,
    },
  ];
}

// ─── MCP tool integration ───

/**
 * Create AgentTools from MCP server tool descriptors.
 *
 * Execution routes through the Rust MCP module via the
 * `mcp_call_tool` Tauri command — no sidecar dependency.
 */
async function discoverMcpTools(): Promise<AgentTool[]> {
  try {
    const { piNative } = await import("@/modules/pi/lib/native");
    const descriptors = await piNative.mcpTools();
    return descriptors
      .filter((d) => d.modelVisible && d.approvalPolicy !== "deny")
      .map(mcpDescriptorToAgentTool);
  } catch {
    return []; // MCP not available or no servers connected
  }
}

function mcpDescriptorToAgentTool(
  desc: import("@/modules/pi/lib/native").McpToolDescriptor,
): AgentTool {
  return {
    name: desc.qualifiedName,
    label: `${desc.serverName}: ${desc.name}`,
    description: `[MCP:${desc.serverName}] ${desc.description}`,
    parameters: desc.inputSchema as TSchema,
    execute: async (
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new Error("Aborted");
      const { piNative } = await import("@/modules/pi/lib/native");
      const result = await piNative.mcpCallTool(desc.qualifiedName, params);
      const text = result.content
        .filter((c: { type: string; text?: string }) => c.type === "text")
        .map((c: { type: string; text?: string }) => c.text ?? "")
        .join("\n");
      return {
        content: [
          { type: "text" as const, text: text || "MCP tool completed." },
        ],
        details: {
          mcp: { toolName: desc.qualifiedName, isError: result.isError },
        },
      } as AgentToolResult<{ mcp: { toolName: string; isError: boolean } }>;
    },
  };
}

// ─── Proxied stream function ───

/**
 * Wraps streamSimple to route LLM API calls through Tauri (bypasses CORS).
 *
 * The Pi SDK's providers (Anthropic, OpenAI, etc.) use global fetch internally
 * via their SDK client libraries. We install a ref-counted proxied fetch that
 * routes through Tauri's ai_http_request command.
 *
 * Ref-counting ensures concurrent streams don't clobber each other's fetch.
 */
function proxiedStreamSimple(
  model: Model<Api>,
  context: Parameters<typeof streamSimple>[1],
  options?: Parameters<typeof streamSimple>[2],
) {
  installProxiedFetch();

  const stream = streamSimple(model, context, options);

  // Safety fallback: uninstall after 10 minutes in case result() never settles.
  const safetyTimer = setTimeout(() => {
    uninstallProxiedFetch();
  }, 600_000);

  // Pair this install with an uninstall when the stream settles. This is the
  // ONLY uninstall point for the webview agent (it doesn't use subscribeToAgent),
  // so without it the proxied fetch would stay installed for the whole app.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(safetyTimer);
    uninstallProxiedFetch();
  };
  void stream.result().then(settle, settle);

  return stream;
}

// ─── Session Factory ───

/**
 * Create a Pi Agent that runs in the webview.
 * All file/shell operations go through Tauri IPC.
 * LLM API calls go through Tauri's HTTP proxy (bypasses CORS).
 * API keys are resolved from env vars via Tauri IPC.
 */
/**
 * Resolve a Pi `Model` for a provider/model id, applying a baseUrl override for
 * custom providers (LMStudio, Ollama, etc.). Shared by agent creation and
 * in-place model switching on resume.
 */
export function resolveAgentModel(options: {
  provider: string;
  modelId: string;
  baseUrl?: string;
}): Model<Api> {
  const model = getModel(options.provider as never, options.modelId as never);
  if (options.baseUrl) {
    return { ...model, baseUrl: options.baseUrl };
  }
  return model;
}

export async function createTauriAgent(
  options: TauriAgentOptions,
): Promise<Agent> {
  const model = resolveAgentModel(options);

  const tools = createAgentTools(options.cwd);

  // Discover and add MCP tools from connected servers
  const mcpTools = await discoverMcpTools();
  tools.push(...mcpTools);

  // Expose an interactive question tool when a gate is provided.
  if (options.questionGate) {
    const questionGate = options.questionGate;
    tools.push({
      name: "ask_question",
      label: "Ask the user",
      description:
        "Ask the user a multiple-choice question when you need a decision you can't make yourself (ambiguous requirements, a fork in approach). Returns the user's selection. Prefer this over guessing.",
      parameters: Type.Object({
        question: Type.String({ description: "The question to ask the user." }),
        options: Type.Array(
          Type.Object({
            label: Type.String({ description: "A short choice label." }),
            description: Type.Optional(
              Type.String({ description: "Optional clarification." }),
            ),
          }),
          { description: "Two to four distinct choices to present." },
        ),
        allowMultiple: Type.Optional(
          Type.Boolean({
            description: "Allow selecting more than one option.",
          }),
        ),
      }),
      execute: (async (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
      ) => {
        const {
          question,
          options: choices,
          allowMultiple,
        } = params as {
          question: string;
          options: PiQuestionOption[];
          allowMultiple?: boolean;
        };
        const answers = await questionGate(
          toolCallId,
          { question, options: choices, allowMultiple: allowMultiple === true },
          signal,
        );
        return textResult(formatQuestionAnswers(answers));
      }) as ToolExecute,
    });
  }

  // Wrap tool execute functions with approval gate if provided
  if (options.approvalGate) {
    const gate = options.approvalGate;
    for (const tool of tools) {
      const originalExecute = tool.execute;
      tool.execute = async (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
      ) => {
        const approved = await gate(tool.name, toolCallId, params);
        if (!approved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Tool execution denied by user: ${tool.name}`,
              },
            ],
            details: { denied: true, toolName: tool.name },
          } as AgentToolResult<{ denied: boolean; toolName: string }>;
        }
        return originalExecute(toolCallId, params, signal);
      };
    }
  }

  const agent = new Agent({
    initialState: {
      systemPrompt:
        options.systemPrompt ??
        "You are a helpful AI coding assistant running inside Terax.",
      model,
      thinkingLevel:
        options.thinkingLevel && options.thinkingLevel !== "off"
          ? (options.thinkingLevel as
              | "minimal"
              | "low"
              | "medium"
              | "high"
              | "xhigh")
          : "medium",
      tools,
    },
    streamFn: proxiedStreamSimple,
    getApiKey: async (provider: string) => {
      return piEnv.getApiKeyForProvider(provider);
    },
    toolExecution: "parallel",
    // Context compaction: when messages grow too large for the model's
    // context window, summarize older turns and keep recent ones intact.
    transformContext: async (
      messages: AgentMessage[],
      signal?: AbortSignal,
    ) => {
      const estimate = estimateContextTokens(messages);
      const contextWindow = model.contextWindow;

      if (
        !shouldCompact(
          estimate.tokens,
          contextWindow,
          DEFAULT_COMPACTION_SETTINGS,
        )
      ) {
        return messages;
      }

      // Find cut point: keep recent messages within keepRecentTokens budget
      const keepRecentTokens = DEFAULT_COMPACTION_SETTINGS.reserveTokens;
      let runningTokens = 0;
      let cutIndex = messages.length;
      for (let i = messages.length - 1; i >= 0; i--) {
        runningTokens += estimateTokens(messages[i]);
        if (runningTokens >= keepRecentTokens) {
          cutIndex = i + 1; // keep this message
          break;
        }
      }

      const oldMessages = messages.slice(0, cutIndex);
      const recentMessages = messages.slice(cutIndex);

      if (oldMessages.length === 0) return messages;

      // Generate summary via LLM (uses global fetch, which is already proxied)
      const apiKey = await piEnv.getApiKeyForProvider(model.provider);
      const result = await generateSummary(
        oldMessages,
        model,
        DEFAULT_COMPACTION_SETTINGS.reserveTokens,
        apiKey ?? "",
        undefined, // headers
        signal,
      );

      if (!result.ok) {
        // Compaction failed — return original messages (will likely fail at the API)
        console.warn("Context compaction failed:", result.error);
        return messages;
      }

      // Replace old messages with a summary message
      const summaryMessage: AgentMessage = {
        role: "user",
        content: [
          { type: "text", text: `[Conversation summary]\n${result.value}` },
        ],
        timestamp: Date.now(),
      } as AgentMessage;

      return [summaryMessage, ...recentMessages];
    },
  });

  return agent;
}

/**
 * Feature flag — controls whether to use webview agent or sidecar.
 */
export const USE_WEBVIEW_AGENT = true;

// ─── Event helpers ───

/**
 * Subscribe to agent events and forward them as typed callbacks.
 * Returns an unsubscribe function.
 *
 * Also manages the proxied fetch lifecycle:
 * - Installs proxied fetch before each stream call (via streamFn)
 * - Uninstalls when agent_end fires
 */
export function subscribeToAgent(
  agent: Agent,
  callbacks: {
    onText?: (text: string) => void;
    onToolCall?: (toolName: string, toolCallId: string, args: unknown) => void;
    onToolResult?: (
      toolName: string,
      toolCallId: string,
      result: unknown,
      isError: boolean,
    ) => void;
    onEnd?: (messages: AgentMessage[]) => void;
    onError?: (error: string) => void;
  },
): () => void {
  return agent.subscribe((event: AgentEvent, _signal: AbortSignal) => {
    switch (event.type) {
      case "message_update": {
        const msg = event.message;
        if (msg.role === "assistant" && "content" in msg && msg.content) {
          for (const block of msg.content) {
            if (block.type === "text" && callbacks.onText) {
              callbacks.onText(block.text);
            }
          }
        }
        break;
      }
      case "tool_execution_start":
        callbacks.onToolCall?.(event.toolName, event.toolCallId, event.args);
        break;
      case "tool_execution_end":
        callbacks.onToolResult?.(
          event.toolName,
          event.toolCallId,
          event.result,
          event.isError,
        );
        break;
      case "agent_end":
        uninstallProxiedFetch();
        callbacks.onEnd?.(event.messages);
        break;
    }
  });
}
