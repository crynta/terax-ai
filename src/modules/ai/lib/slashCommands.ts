import {
  CheckListIcon,
  Exchange01Icon,
  SparklesIcon,
  Sun01Icon,
} from "@hugeicons/core-free-icons";
import { usePlanStore } from "../store/planStore";
import { lookupExchangeRate, lookupWeather } from "./webLookup";

/**
 * Outcome of intercepting a slash command from the composer.
 *
 * - `"handled"`: command ran; the composer should NOT send a chat message.
 * - `"send-prompt"`: replace the user's text with `prompt` and send normally.
 * - `"none"`: not a slash command; let the composer behave as usual.
 */
export type SlashOutcome =
  | { kind: "handled"; toast?: string }
  | { kind: "local-run"; execute: () => Promise<string> }
  | { kind: "send-prompt"; prompt: string; commandName?: string }
  | { kind: "none" };

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

export const SLASH_COMMANDS: Record<string, SlashCommandMeta> = {
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
  weather: {
    name: "weather",
    invocation: "/weather",
    label: "Get weather",
    icon: Sun01Icon,
  },
  exchange: {
    name: "exchange",
    invocation: "/exchange",
    label: "Exchange rate",
    icon: Exchange01Icon,
  },
};

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
    case "weather": {
      const city = tail || "London";
      const parts = city.split(/\s+/);
      const units =
        parts[parts.length - 1] === "imperial" ? "imperial" : "metric";
      const cityName =
        units === "imperial" ? parts.slice(0, -1).join(" ") || city : city;
      return {
        kind: "local-run",
        execute: () => lookupWeather(cityName, units),
      };
    }
    case "exchange": {
      const [from = "USD", to = "EUR", amtStr] = tail.split(/\s+/);
      const amount = amtStr ? parseFloat(amtStr) : 1;
      return {
        kind: "local-run",
        execute: () =>
          lookupExchangeRate(from, to, Number.isFinite(amount) ? amount : 1),
      };
    }
    default:
      return { kind: "none" };
  }
}
