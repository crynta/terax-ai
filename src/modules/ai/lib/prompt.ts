import type { ModelMessage, SystemModelMessage } from "ai";
import type { ProviderId } from "@/modules/ai/config";

export type PreparedAgentPrompt = {
  system: SystemModelMessage[];
  messages: ModelMessage[];
};

export function prepareAgentPrompt(
  stableSystem: string,
  planInstructions: string | null,
  history: readonly ModelMessage[],
  provider: ProviderId,
): PreparedAgentPrompt {
  const system: SystemModelMessage[] = [
    { role: "system", content: stableSystem },
  ];
  if (planInstructions) {
    system.push({ role: "system", content: planInstructions });
  }
  const messages = history.slice();
  if (provider !== "anthropic") return { system, messages };

  system[0] = withAnthropicCacheMarker(system[0]);
  const lastIdx = messages.length - 1;
  if (lastIdx >= 0) {
    messages[lastIdx] = withAnthropicCacheMarker(messages[lastIdx]);
  }
  return { system, messages };
}

function withAnthropicCacheMarker<T extends ModelMessage>(message: T): T {
  return {
    ...message,
    providerOptions: {
      ...(message.providerOptions ?? {}),
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}
