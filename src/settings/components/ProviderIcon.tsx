import AppleIcon from "@hugeicons/core-free-icons/AppleIcon";
import ChatGptIcon from "@hugeicons/core-free-icons/ChatGptIcon";
import ClaudeIcon from "@hugeicons/core-free-icons/ClaudeIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import CpuIcon from "@hugeicons/core-free-icons/CpuIcon";
import DeepseekIcon from "@hugeicons/core-free-icons/DeepseekIcon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon";
import GoogleGeminiIcon from "@hugeicons/core-free-icons/GoogleGeminiIcon";
import Grok02Icon from "@hugeicons/core-free-icons/Grok02Icon";
import MistralIcon from "@hugeicons/core-free-icons/MistralIcon";
import PlugIcon from "@hugeicons/core-free-icons/Plug01Icon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";
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
