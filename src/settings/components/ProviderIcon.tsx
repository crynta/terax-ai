import {
  AppleIcon,
  ChatGptIcon,
  ClaudeIcon,
  ComputerIcon,
  CpuIcon,
  DeepseekIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  MistralIcon,
  PlugIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ProviderId } from "@/modules/ai/config";

const ICON_BY_PROVIDER = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

type Props = {
  provider: string;
  size?: number;
  className?: string;
};

export function ProviderIcon({ provider, size = 14, className }: Props) {
  const icon = ICON_BY_PROVIDER[provider as ProviderId] ?? PlugIcon;
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
