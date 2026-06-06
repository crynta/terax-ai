import AiGenerativeIcon from "@hugeicons/core-free-icons/AiGenerativeIcon";
import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ChatGptIcon from "@hugeicons/core-free-icons/ChatGptIcon";
import ClaudeIcon from "@hugeicons/core-free-icons/ClaudeIcon";
import CursorMagicSelection02Icon from "@hugeicons/core-free-icons/CursorMagicSelection02Icon";
import OpenSourceIcon from "@hugeicons/core-free-icons/OpenSourceIcon";
import RoboticIcon from "@hugeicons/core-free-icons/RoboticIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { agentProviderByName } from "./providers";

export type AgentIconKind =
  | "terax"
  | "claude"
  | "codex"
  | "pi"
  | "cursor"
  | "opencode"
  | "gemini"
  | "antigravity"
  | "generic";

export function agentIconKind(agent: string): AgentIconKind {
  return agentProviderByName(agent)?.iconKind ?? "generic";
}

function iconFor(kind: Exclude<AgentIconKind, "terax" | "pi">): IconSvgElement {
  switch (kind) {
    case "claude":
      return ClaudeIcon;
    case "codex":
      return ChatGptIcon;
    case "cursor":
      return CursorMagicSelection02Icon;
    case "opencode":
      return OpenSourceIcon;
    case "gemini":
      return AiGenerativeIcon;
    case "antigravity":
      return AiMagicIcon;
    case "generic":
      return RoboticIcon;
  }
}

export function AgentIcon({
  agent,
  size = 15,
  className,
}: {
  agent: string;
  size?: number;
  className?: string;
}) {
  const kind = agentIconKind(agent);
  if (kind === "terax") {
    return (
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  if (kind === "pi") {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          alignItems: "center",
          display: "inline-flex",
          fontSize: Math.max(11, Math.round(size * 0.9)),
          fontWeight: 700,
          height: size,
          justifyContent: "center",
          lineHeight: `${size}px`,
          width: size,
        }}
      >
        π
      </span>
    );
  }
  return (
    <HugeiconsIcon
      icon={iconFor(kind)}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
