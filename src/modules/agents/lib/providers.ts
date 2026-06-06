export type AgentProviderId =
  | "terax"
  | "pi"
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "gemini"
  | "antigravity";

export type AgentProviderIconKind = AgentProviderId;

export type AgentProvider = {
  id: AgentProviderId;
  label: string;
  aliases: readonly string[];
  iconKind: AgentProviderIconKind;
};

export type AgentHookProviderId = Extract<
  AgentProviderId,
  "claude" | "codex" | "gemini" | "antigravity"
>;

export type AgentHookTarget = {
  id: AgentHookProviderId;
  statusCommand: string;
  enableCommand: string;
  enableLabel: string;
  enabledLabel: string;
  errorLabel: string;
};

export const AGENT_PROVIDERS = [
  {
    id: "terax",
    label: "Terax AI",
    aliases: ["terax", "terax ai", "local agent"],
    iconKind: "terax",
  },
  {
    id: "pi",
    label: "Pi",
    aliases: ["pi", "pi agent"],
    iconKind: "pi",
  },
  {
    id: "claude",
    label: "Claude Code",
    aliases: ["claude", "claude code"],
    iconKind: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    aliases: ["codex", "codex cli", "openai", "gpt", "chatgpt"],
    iconKind: "codex",
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    aliases: ["cursor", "cursor agent", "cursor-agent"],
    iconKind: "cursor",
  },
  {
    id: "opencode",
    label: "OpenCode",
    aliases: ["opencode", "open code"],
    iconKind: "opencode",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    aliases: ["gemini", "gemini cli"],
    iconKind: "gemini",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    aliases: ["agy", "antigravity", "antigravity cli"],
    iconKind: "antigravity",
  },
] as const satisfies readonly AgentProvider[];

export const AGENT_HOOK_TARGETS = [
  {
    id: "claude",
    statusCommand: "agent_claude_hooks_status",
    enableCommand: "agent_enable_claude_hooks",
    enableLabel: "Enable Claude Code alerts",
    enabledLabel: "Claude Code alerts enabled",
    errorLabel: "Could not update Claude Code config.",
  },
  {
    id: "codex",
    statusCommand: "agent_codex_hooks_status",
    enableCommand: "agent_enable_codex_hooks",
    enableLabel: "Enable Codex alerts",
    enabledLabel: "Codex alerts enabled",
    errorLabel: "Could not update Codex config.",
  },
  {
    id: "gemini",
    statusCommand: "agent_gemini_hooks_status",
    enableCommand: "agent_enable_gemini_hooks",
    enableLabel: "Enable Gemini alerts",
    enabledLabel: "Gemini alerts enabled",
    errorLabel: "Could not update Gemini config.",
  },
  {
    id: "antigravity",
    statusCommand: "agent_antigravity_hooks_status",
    enableCommand: "agent_enable_antigravity_hooks",
    enableLabel: "Enable Antigravity alerts",
    enabledLabel: "Antigravity alerts enabled",
    errorLabel: "Could not update Antigravity config.",
  },
] as const satisfies readonly AgentHookTarget[];

const PROVIDER_BY_ID = new Map(
  AGENT_PROVIDERS.map((provider) => [provider.id, provider]),
);

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function agentProviderById(
  id: AgentProviderId,
): AgentProvider | undefined {
  return PROVIDER_BY_ID.get(id);
}

export function agentProviderByName(
  name: string | null | undefined,
): AgentProvider | undefined {
  const normalized = normalizeProviderName(name ?? "");
  if (!normalized) return undefined;

  const exact = AGENT_PROVIDERS.find(
    (provider) =>
      normalizeProviderName(provider.label) === normalized ||
      provider.aliases.some(
        (alias) => normalizeProviderName(alias) === normalized,
      ),
  );
  if (exact) return exact;

  return AGENT_PROVIDERS.find((provider) =>
    provider.aliases.some((alias) => {
      const normalizedAlias = normalizeProviderName(alias);
      return (
        normalizedAlias.length >= 4 && normalized.includes(normalizedAlias)
      );
    }),
  );
}

export function agentProviderLabel(name: string): string {
  return agentProviderByName(name)?.label ?? name;
}
