import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import ClaudeIcon from "@hugeicons/core-free-icons/ClaudeIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import { areOpenClickyAiToolsEnabled } from "./featureGates";
import { usePlanStore } from "../store/planStore";

/**
 * Outcome of intercepting a slash command from the composer.
 *
 * - `"handled"`: command ran; the composer should NOT send a chat message.
 * - `"send-prompt"`: replace the user's text with `prompt` and send normally.
 * - `"none"`: not a slash command; let the composer behave as usual.
 */
export type SlashOutcome =
  | { kind: "handled"; toast?: string }
  | { kind: "send-prompt"; prompt: string; commandName?: string }
  | { kind: "none" };

function claudeCodeDirective(request: string): string {
  return `The user wants to drive a Claude Code agent through you. Their request:

<request>
${request}
</request>

You are the orchestrator, not the implementer. Do not write the code yourself.
1. Call read_agent_output to see whether a Claude Code agent is already active in this session.
2. If none is active: turn the request into one clear, complete, self-contained prompt (state the concrete goal, relevant constraints, and what "done" looks like) and call spawn_coding_agent with it.
3. If one is active: read its latest output, then craft a precise follow-up and call send_to_agent.
Sharpen vague requests into precise engineering instructions; keep each agent prompt focused on one coherent unit of work.`;
}

const INIT_PROMPT = `Scan this workspace and produce TERAX.md at the workspace root with:

- One-paragraph project description.
- Build / test / dev commands.
- Architecture overview (subsystems, data flow, key dirs).
- Conventions worth knowing (naming, patterns, gotchas).
- Paths to entry points.

Use grep/glob/list_directory/read_file to explore. Cap TERAX.md under 200 lines. Use write_file to create it (will go through normal approval).`;

export type SlashCommandMeta = {
  name: string;
  invocation: string;
  label: string;
  icon: typeof SparklesIcon;
};

const ALL_SLASH_COMMANDS: Record<string, SlashCommandMeta> = {
  init: {
    name: "init",
    invocation: "/init",
    label: "Initialize workspace",
    icon: SparklesIcon,
  },
  plan: {
    name: "plan",
    invocation: "/plan",
    label: "Plan mode",
    icon: CheckListIcon,
  },
  "claude-code": {
    name: "claude-code",
    invocation: "/claude-code",
    label: "Delegate to Claude Code",
    icon: ClaudeIcon,
  },
  "3d": {
    name: "3d",
    invocation: "/3d",
    label: "Generate 3D model",
    icon: AiMagicIcon,
  },
};

export const SLASH_COMMANDS = ALL_SLASH_COMMANDS;

export function availableSlashCommands(): SlashCommandMeta[] {
  return Object.values(ALL_SLASH_COMMANDS).filter(
    (command) => command.name !== "3d" || areOpenClickyAiToolsEnabled(),
  );
}

export const TERAX_CMD_RE =
  /^<terax-command\s+name="([a-z0-9-]+)"(?:\s+state="([a-z]+)")?\s*\/>(?:\n+|$)/;

export function wrapWithCommandMarker(prompt: string, name: string): string {
  return `<terax-command name="${name}" />\n\n${prompt}`;
}

export function tryRunSlashCommand(input: string): SlashOutcome {
  const trimmed = input.trim();
  const lead = trimmed[0];
  if (lead !== "/" && lead !== "#") return { kind: "none" };
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  if (lead === "#" && !SLASH_COMMANDS[head]) return { kind: "none" };
  const tail = rest.join(" ").trim();

  switch (head) {
    case "plan": {
      const store = usePlanStore.getState();
      if (tail === "off" || tail === "exit") {
        store.disable();
        return { kind: "handled", toast: "Plan mode off" };
      }
      store.toggle();
      const nowActive = usePlanStore.getState().active;
      return {
        kind: "handled",
        toast: nowActive ? "Plan mode on" : "Plan mode off",
      };
    }
    case "init": {
      return {
        kind: "send-prompt",
        prompt: INIT_PROMPT,
        commandName: "init",
      };
    }
    case "claude-code": {
      if (!tail) {
        return { kind: "handled", toast: "Usage: /claude-code <request>" };
      }
      return {
        kind: "send-prompt",
        prompt: claudeCodeDirective(tail),
        commandName: "claude-code",
      };
    }
    case "3d": {
      if (!areOpenClickyAiToolsEnabled()) {
        return {
          kind: "handled",
          toast:
            "3D generation is experimental and disabled for this build. Enable terax.experimental.openclickyAiTools to expose it.",
        };
      }
      if (!tail) {
        return { kind: "handled", toast: "Usage: /3d <description of model>" };
      }
      return {
        kind: "send-prompt",
        prompt: `Generate a 3D model based on this description: "${tail}". Use the generate_3d_model tool if available, otherwise describe what the model would look like.`,
        commandName: "3d",
      };
    }
    default:
      return { kind: "none" };
  }
}
