/**
 * Pi SDK Webview Bridge - Agent Session Factory
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
import { isE2eMockEnabled } from "@/modules/ai/lib/mockFlags";
import { formatQuestionAnswers } from "@/modules/pi/lib/question-registry";
import type {
  PiQuestionAnswer,
  PiQuestionOption,
} from "@/modules/pi/lib/sessions";
import { piEnv } from "./pi-env";
import { ensureMockPiModel } from "./pi-mock";
import { installProxiedFetch, uninstallProxiedFetch } from "./pi-http";
import { executeAgentTool, grantAgentTool } from "./pi-tools";
import type { NativeToolResult } from "./pi-tools";

// ─── Types ───

export type TauriAgentOptions = {
  /** Working directory for file/shell operations */
  cwd: string;
  /**
   * Session id. Threaded into every tool call so the Rust verified executor
   * (`pi_agent_tool_execute`) can match user-issued approval grants. Required
   * for tool execution; without it mutating/Ask tools will be denied by Rust.
   */
  sessionId: string;
  /** System prompt */
  systemPrompt?: string;
  /** Provider name (e.g. "anthropic", "openai") */
  provider: string;
  /** Model ID within the provider (e.g. "claude-sonnet-4-20250514") */
  modelId: string;
  /** Optional base URL override */
  baseUrl?: string;
  /**
   * Custom (OpenAI-compatible) endpoint id, when the model is a custom
   * endpoint. Its API key lives under `compat-<id>-api-key` in the keyring,
   * not under the provider name, so it needs a dedicated lookup.
   */
  customEndpointId?: string;
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

// biome-ignore lint/suspicious/noExplicitAny: SDK AgentTool is generic over per-tool schema; erased to share one execute signature
type ToolExecute = AgentTool<any>["execute"];

// ─── Tool factory ───

/**
 * Agent tool name to native dispatcher tool name. The native dispatcher
 * (`execute_with_context` on the Rust side) is the workspace-scoped, secret-path
 * filtered implementation; grants are keyed by the native name so the approval
 * recorded by the UI matches what the executor consumes.
 */
const AGENT_TO_NATIVE_TOOL: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  list_directory: "ls",
  bash_run: "bash",
  grep: "grep",
  glob: "find",
};

function nativeToolName(agentToolName: string): string {
  return AGENT_TO_NATIVE_TOOL[agentToolName] ?? agentToolName;
}

function toAgentResult(result: NativeToolResult): AgentToolResult<unknown> {
  const content =
    result.content && result.content.length > 0
      ? result.content.map((item) => ({
          type: "text" as const,
          text: item.text ?? "",
        }))
      : [{ type: "text" as const, text: "(no output)" }];
  return {
    content,
    details: result.details,
  } as AgentToolResult<unknown>;
}

type NativeToolSpec = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  buildInput: (params: Record<string, unknown>) => unknown;
};

const NATIVE_TOOL_SPECS: NativeToolSpec[] = [
  {
    name: "read_file",
    label: "Read file",
    description: "Read a file's contents.",
    parameters: Type.Object({
      path: Type.String({ description: "File path" }),
    }),
    buildInput: (p) => ({ path: p.path }),
  },
  {
    name: "write_file",
    label: "Write file",
    description: "Write content to a file.",
    parameters: Type.Object({
      path: Type.String(),
      content: Type.String(),
    }),
    buildInput: (p) => ({ path: p.path, content: p.content }),
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
    buildInput: (p) => ({ path: p.path, edits: p.edits }),
  },
  {
    name: "list_directory",
    label: "List directory",
    description: "List entries in a directory.",
    parameters: Type.Object({
      path: Type.String(),
    }),
    buildInput: (p) => ({ path: p.path }),
  },
  {
    name: "bash_run",
    label: "Run command",
    description:
      "Run a shell command and return stdout, stderr, and exit code.",
    parameters: Type.Object({
      command: Type.String(),
    }),
    buildInput: (p) => ({ command: p.command }),
  },
  {
    name: "grep",
    label: "Search files",
    description: "Search file contents with a regex pattern.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.String({ description: "Root directory to search" }),
    }),
    buildInput: (p) => ({ pattern: p.pattern, path: p.path }),
  },
  {
    name: "glob",
    label: "Find files",
    description: "Find files matching a glob pattern.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.String({ description: "Root directory to search" }),
    }),
    buildInput: (p) => ({ pattern: p.pattern, path: p.path }),
  },
];

function createAgentTools(cwd: string, sessionId: string): AgentTool[] {
  return NATIVE_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    execute: (async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new Error("Aborted");
      try {
        const result = await executeAgentTool({
          sessionId,
          toolCallId,
          toolName: nativeToolName(spec.name),
          cwd,
          input: spec.buildInput((params as Record<string, unknown>) ?? {}),
        });
        if (signal?.aborted) throw new Error("Aborted");
        return toAgentResult(result);
      } catch (e) {
        return errorResult(String(e));
      }
    }) as ToolExecute,
  }));
}

// ─── MCP tool integration ───

/**
 * Create AgentTools from MCP server tool descriptors.
 *
 * Execution routes through the Rust MCP module via the
 * `mcp_call_tool` Tauri command - no sidecar dependency.
 */
async function discoverMcpTools(
  cwd: string,
  sessionId: string,
): Promise<AgentTool[]> {
  try {
    const { piNative } = await import("@/modules/pi/lib/native");
    const descriptors = await piNative.mcpTools();
    return descriptors
      .filter((d) => d.modelVisible && d.approvalPolicy !== "deny")
      .map((desc) => mcpDescriptorToAgentTool(desc, cwd, sessionId));
  } catch {
    return []; // MCP not available or no servers connected
  }
}

function mcpDescriptorToAgentTool(
  desc: import("@/modules/pi/lib/native").McpToolDescriptor,
  cwd: string,
  sessionId: string,
): AgentTool {
  return {
    name: desc.qualifiedName,
    label: `${desc.serverName}: ${desc.name}`,
    description: `[MCP:${desc.serverName}] ${desc.description}`,
    parameters: desc.inputSchema as TSchema,
    execute: (async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new Error("Aborted");
      // MCP tools route through the same Rust verified executor as native
      // tools, so their capability policy and approval are enforced and audited
      // in Rust rather than the webview.
      try {
        const result = await executeAgentTool({
          sessionId,
          toolCallId,
          toolName: desc.qualifiedName,
          cwd,
          input: params ?? {},
        });
        return toAgentResult(result);
      } catch (e) {
        return errorResult(String(e));
      }
    }) as ToolExecute,
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
  // E2E (Phase C): when the flag is set there are no real provider keys, so all
  // pi sessions use the deterministic offline faux model. Mirrors the AI-SDK
  // mock on the chat side. Never reachable in normal use.
  if (isE2eMockEnabled()) {
    return ensureMockPiModel();
  }
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

  const tools = createAgentTools(options.cwd, options.sessionId);

  // Discover and add MCP tools from connected servers
  const mcpTools = await discoverMcpTools(options.cwd, options.sessionId);
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

  // Wrap tool execute functions with the approval gate. The gate produces the
  // approval UX and decides allow/deny; on approval we record a single-use grant
  // in Rust keyed by the native tool name, which the verified executor consumes.
  // The gate is UX only: Rust independently enforces policy and the grant, so a
  // bypassed gate cannot execute an Ask/Deny tool.
  if (options.approvalGate) {
    const gate = options.approvalGate;
    const sessionId = options.sessionId;
    for (const tool of tools) {
      // ask_question is an interactive elicitation tool, not a workspace tool;
      // it does not route through the verified executor, so it is not gated here.
      if (tool.name === "ask_question") continue;
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
        try {
          await grantAgentTool(
            sessionId,
            toolCallId,
            nativeToolName(tool.name),
          );
        } catch (e) {
          // If the grant cannot be recorded, the verified executor will deny
          // Ask-level tools (fail-closed); Auto tools proceed regardless. Log
          // so the cause is visible rather than silently swallowed.
          console.warn(
            `pi: failed to record approval grant for ${tool.name}`,
            e,
          );
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
      // Custom endpoints key by endpoint id, not provider name.
      if (options.customEndpointId) {
        return piEnv.getCustomEndpointApiKey(options.customEndpointId);
      }
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
        // Compaction failed - return original messages (will likely fail at the API)
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
