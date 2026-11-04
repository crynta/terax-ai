import { card, type LayoutNode, split } from "@/modules/workbench/model/layout";

export const AGENT_LAUNCHERS = [
  {
    id: "claude",
    label: "Claude",
    defaultCommand: "claude",
    supportsHooks: true,
  },
  {
    id: "codex",
    label: "Codex",
    defaultCommand: "codex",
    supportsHooks: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    defaultCommand: "gemini",
    supportsHooks: true,
  },
  {
    id: "pi",
    label: "Pi",
    defaultCommand: "pi",
    supportsHooks: true,
  },
  {
    id: "opencode",
    label: "OpenCode",
    defaultCommand: "opencode",
    supportsHooks: false,
  },
  {
    id: "grok",
    label: "Grok",
    defaultCommand: "grok",
    supportsHooks: false,
  },
] as const;

export type AgentLauncherId = (typeof AGENT_LAUNCHERS)[number]["id"];
export type AgentInstanceCount = 1 | 2 | 3 | 4;
export type AgentLaunchCommands = Record<AgentLauncherId, string>;

export type AgentLaunchRequest = {
  agent: AgentLauncherId;
  command: string;
  instances: AgentInstanceCount;
};

export const DEFAULT_AGENT_LAUNCH_COMMANDS: AgentLaunchCommands =
  Object.fromEntries(
    AGENT_LAUNCHERS.map((agent) => [agent.id, agent.defaultCommand]),
  ) as AgentLaunchCommands;

const MAX_AGENT_COMMAND_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type AgentCommandValidation =
  | { ok: true; command: string }
  | { ok: false; error: string };

export function validateAgentLaunchCommand(
  value: unknown,
): AgentCommandValidation {
  if (typeof value !== "string") {
    return { ok: false, error: "Enter a start command." };
  }
  const command = value.trim();
  if (!command) return { ok: false, error: "Enter a start command." };
  if (command.length > MAX_AGENT_COMMAND_LENGTH) {
    return {
      ok: false,
      error: `Keep the command under ${MAX_AGENT_COMMAND_LENGTH} characters.`,
    };
  }
  if (CONTROL_CHARACTERS.test(command)) {
    return { ok: false, error: "Use a single-line command." };
  }
  return { ok: true, command };
}

export function normalizeAgentLaunchCommands(
  value: unknown,
): AgentLaunchCommands {
  const stored =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    AGENT_LAUNCHERS.map((agent) => {
      const result = validateAgentLaunchCommand(stored[agent.id]);
      return [
        agent.id,
        result.ok ? result.command : agent.defaultCommand,
      ] as const;
    }),
  ) as AgentLaunchCommands;
}

export function findAgentLauncher(id: AgentLauncherId) {
  return AGENT_LAUNCHERS.find((agent) => agent.id === id) ?? AGENT_LAUNCHERS[0];
}

export type AgentPanePlan = {
  layout: LayoutNode;
  /** Terminal tab ids, one per agent; a terminal's id is its leaf id. */
  leafIds: number[];
  focusedCardId: number;
};

export function createAgentPanePlan(
  instances: AgentInstanceCount,
  allocateId: () => number,
): AgentPanePlan {
  if (!Number.isInteger(instances) || instances < 1 || instances > 4) {
    throw new RangeError("Agent instance count must be between 1 and 4.");
  }

  const leafIds = Array.from({ length: instances }, () => allocateId());
  const cards = leafIds.map((id) => card(allocateId(), [id]));
  const plan = (layout: LayoutNode): AgentPanePlan => ({
    layout,
    leafIds,
    focusedCardId: cards[0].id,
  });

  switch (instances) {
    case 1:
      return plan(cards[0]);
    case 2:
      return plan(split(allocateId(), "row", cards));
    case 3:
      return plan(
        split(allocateId(), "row", [
          cards[0],
          split(allocateId(), "col", [cards[1], cards[2]]),
        ]),
      );
    case 4:
      return plan(
        split(allocateId(), "row", [
          split(allocateId(), "col", [cards[0], cards[1]]),
          split(allocateId(), "col", [cards[2], cards[3]]),
        ]),
      );
  }
}
