import { quoteShellArg } from "@/lib/shellQuote";

export type PiLocalAgentId =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "pi"
  | "gemini"
  | "antigravity";
export type PiLocalAgentLaunchMode = "plan" | "guarded";
export type PiLocalAgentPromptHandoff = "flag" | "positional" | null;

export type PiLocalAgentDef = {
  id: PiLocalAgentId;
  label: string;
  binary: string;
  docsUrl: string;
  defaultLaunchMode: PiLocalAgentLaunchMode;
  planCommand: string | null;
  promptHandoff: PiLocalAgentPromptHandoff;
  promptFlag?: string;
  launchEnvironment?: Record<string, string>;
  requiresPosixShell?: boolean;
  launchUnavailableReason: string | null;
  guardrail: string;
  hookCommand: string | null;
};

export type PiLocalAgentBinaryStatus = {
  binary: string;
  path: string | null;
};

export type PiLocalAgentStatus = PiLocalAgentDef & {
  installed: boolean;
  path: string | null;
};

export type PiLocalAgentLaunchRequest = {
  id: PiLocalAgentId;
  label: string;
  command: string;
  prompt: string | null;
};

export const PI_LOCAL_AGENT_POLICY = {
  hiddenProcessSpawns: false,
  posture: "Safe visible terminal launch",
} as const;

const OPENCODE_TERAX_PLAN_PERMISSION = {
  "*": "deny",
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  edit: "deny",
  bash: "deny",
  task: "deny",
  skill: "deny",
  external_directory: "deny",
  lsp: "deny",
  todowrite: "deny",
  webfetch: "deny",
  websearch: "deny",
  doom_loop: "deny",
  question: "ask",
} as const;

export const OPENCODE_TERAX_PLAN_CONFIG = JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  share: "disabled",
  autoupdate: false,
  default_agent: "terax-plan",
  permission: OPENCODE_TERAX_PLAN_PERMISSION,
  agent: {
    "terax-plan": {
      description:
        "Terax read-only planning agent. It may inspect files and search the workspace, but cannot edit files, run shell commands, invoke subagents, load skills, or access external directories.",
      mode: "primary",
      permission: OPENCODE_TERAX_PLAN_PERMISSION,
    },
  },
});

export const OPENCODE_TERAX_PLAN_COMMAND = [
  'TERAX_OPENCODE_HOME="$(mktemp -d)"',
  "&&",
  'mkdir -p "$TERAX_OPENCODE_HOME/config/opencode" "$TERAX_OPENCODE_HOME/cache" "$TERAX_OPENCODE_HOME/state"',
  "&&",
  "env",
  'HOME="$TERAX_OPENCODE_HOME"',
  'XDG_CONFIG_HOME="$TERAX_OPENCODE_HOME/config"',
  'XDG_CACHE_HOME="$TERAX_OPENCODE_HOME/cache"',
  'XDG_STATE_HOME="$TERAX_OPENCODE_HOME/state"',
  'XDG_DATA_HOME="$HOME/.local/share"',
  'OPENCODE_CONFIG_DIR="$TERAX_OPENCODE_HOME/config/opencode"',
  "OPENCODE_DISABLE_PROJECT_CONFIG=1",
  "OPENCODE_DISABLE_CLAUDE_CODE=1",
  "OPENCODE_DISABLE_AUTOUPDATE=1",
  `OPENCODE_CONFIG_CONTENT=${quoteShellArg(OPENCODE_TERAX_PLAN_CONFIG, false)}`,
  "opencode --pure --agent terax-plan",
].join(" ");

function sanitizePromptForShell(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export type PiLocalAgentLaunchCommandOptions = {
  windowsShell?: boolean;
};

function shellQuote(
  value: string,
  options: PiLocalAgentLaunchCommandOptions = {},
): string {
  return quoteShellArg(sanitizePromptForShell(value), options.windowsShell);
}

function buildLaunchEnvironmentPrefix(
  agent: PiLocalAgentDef,
  options: PiLocalAgentLaunchCommandOptions,
): string | null {
  const entries = Object.entries(agent.launchEnvironment ?? {});
  if (entries.length === 0) return "";

  // Windows cmd/PowerShell env assignment has different quoting semantics and
  // OpenCode isolation depends on JSON env content. Keep Windows detect-only
  // until a native env-aware terminal launch path is available.
  if (options.windowsShell) return null;

  return entries
    .map(
      ([key, value]) => `${key}=${shellQuote(value, { windowsShell: false })}`,
    )
    .join(" ");
}

export const PI_LOCAL_AGENT_DEFS = [
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    defaultLaunchMode: "plan",
    planCommand: "claude --permission-mode plan",
    promptHandoff: "positional",
    launchUnavailableReason: null,
    guardrail: "Starts in plan mode. Edits still need CLI approval.",
    hookCommand: "agent_enable_claude_hooks",
  },
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    docsUrl: "https://developers.openai.com/codex/cli",
    defaultLaunchMode: "plan",
    planCommand: "codex --sandbox read-only --ask-for-approval on-request",
    promptHandoff: "positional",
    launchUnavailableReason: null,
    guardrail: "Read-only sandbox. Command approval stays interactive.",
    hookCommand: "agent_enable_codex_hooks",
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    binary: "cursor-agent",
    docsUrl: "https://cursor.com/docs/cli",
    defaultLaunchMode: "plan",
    planCommand: "cursor-agent --mode plan",
    promptHandoff: "positional",
    launchUnavailableReason: null,
    guardrail: "Plan mode in a visible terminal, not hidden headless mode.",
    hookCommand: null,
  },
  {
    id: "opencode",
    label: "OpenCode",
    binary: "opencode",
    docsUrl: "https://opencode.ai/docs/cli",
    defaultLaunchMode: "guarded",
    planCommand: OPENCODE_TERAX_PLAN_COMMAND,
    promptHandoff: "flag",
    promptFlag: "--prompt",
    requiresPosixShell: true,
    launchUnavailableReason: null,
    guardrail:
      "Pure OpenCode launch with temp HOME/XDG config, preserved auth data, and Terax-owned read-only permissions. Local Windows launch stays disabled until env isolation is native.",
    hookCommand: null,
  },
  {
    id: "pi",
    label: "Pi",
    binary: "pi",
    docsUrl:
      "https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
    defaultLaunchMode: "guarded",
    planCommand: "pi --tools read,grep,find,ls",
    promptHandoff: "positional",
    launchUnavailableReason: null,
    guardrail: "Read/search-only Pi launch. No bash, edit, or write tools.",
    hookCommand: null,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    binary: "gemini",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    defaultLaunchMode: "plan",
    planCommand: "gemini --approval-mode plan",
    promptHandoff: "flag",
    promptFlag: "--prompt-interactive",
    launchUnavailableReason: null,
    guardrail:
      "Gemini plan approval mode keeps the session read-only. Prompt handoff uses --prompt-interactive so the terminal stays live.",
    hookCommand: "agent_enable_gemini_hooks",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    binary: "agy",
    docsUrl: "https://antigravity.google/product/antigravity-cli",
    defaultLaunchMode: "guarded",
    planCommand: "agy --sandbox",
    promptHandoff: "flag",
    promptFlag: "--prompt-interactive",
    launchUnavailableReason: null,
    guardrail:
      "Starts AGY with terminal sandbox restrictions in a visible terminal. Permissions stay interactive; no dangerous auto-approval flags.",
    hookCommand: "agent_enable_antigravity_hooks",
  },
] as const satisfies readonly PiLocalAgentDef[];

export function piLocalAgentHookCommand(agentId: PiLocalAgentId): string | null {
  return PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === agentId)?.hookCommand ?? null;
}

export function buildPiLocalAgentLaunchCommand(
  agent: PiLocalAgentDef,
  prompt?: string | null,
  options: PiLocalAgentLaunchCommandOptions = {},
): string | null {
  if (agent.planCommand === null) return null;
  if (agent.requiresPosixShell && options.windowsShell) return null;

  const envPrefix = buildLaunchEnvironmentPrefix(agent, options);
  if (envPrefix === null) return null;

  const baseCommand = envPrefix
    ? `${envPrefix} ${agent.planCommand}`
    : agent.planCommand;
  const safePrompt = sanitizePromptForShell(prompt ?? "").trim();
  if (safePrompt === "" || agent.promptHandoff === null) {
    return baseCommand;
  }

  if (agent.promptHandoff === "flag") {
    return `${baseCommand} ${agent.promptFlag ?? "--prompt"} ${shellQuote(
      safePrompt,
      options,
    )}`;
  }

  return `${baseCommand} ${shellQuote(safePrompt, options)}`;
}

export function buildPiLocalAgentStatuses(
  detected: readonly PiLocalAgentBinaryStatus[],
): PiLocalAgentStatus[] {
  const byBinary = new Map(
    detected.map((item) => [item.binary, item.path?.trim() || null]),
  );
  return PI_LOCAL_AGENT_DEFS.map((agent) => {
    const path = byBinary.get(agent.binary) ?? null;
    return {
      ...agent,
      installed: path !== null,
      path,
    };
  });
}

export function piLocalAgentInstallSummary(
  statuses: readonly PiLocalAgentStatus[],
): { installed: number; total: number } {
  return {
    installed: statuses.filter((status) => status.installed).length,
    total: statuses.length,
  };
}

export function piLocalAgentById(
  id: PiLocalAgentId,
): PiLocalAgentDef | undefined {
  return PI_LOCAL_AGENT_DEFS.find((agent) => agent.id === id);
}

export function piLocalAgentByName(
  name: string | null | undefined,
): PiLocalAgentDef | undefined {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return undefined;
  return PI_LOCAL_AGENT_DEFS.find(
    (agent) =>
      agent.id === normalized ||
      agent.binary.toLowerCase() === normalized ||
      agent.label.toLowerCase() === normalized,
  );
}
