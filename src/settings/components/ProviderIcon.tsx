import type { ProviderId } from "@/modules/ai/config";
import {
  ChatGptIcon,
  ClaudeIcon,
  ComputerIcon,
  FlashIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  CpuIcon,
  DeepseekIcon,
  GlobeIcon,
  PlugIcon,
  Rocket01Icon,
  FireworksIcon,
  Search01Icon,
  DatabaseIcon,
  Moon02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const ICON_BY_PROVIDER = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: GlobeIcon,
  openrouter: GlobeIcon,
  together: Rocket01Icon,
  fireworks: FireworksIcon,
  perplexity: Search01Icon,
  cohere: DatabaseIcon,
  moonshot: Moon02Icon,
  ollama: ServerStack01Icon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

type Props = {
  provider: ProviderId;
  size?: number;
  className?: string;
};

export function ProviderIcon({ provider, size = 14, className }: Props) {
  return (
    <HugeiconsIcon
      icon={ICON_BY_PROVIDER[provider]}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
