import { shortcutLabel } from "@/modules/shortcuts";
import { KbdChip } from "@/modules/shortcuts/KbdChip";
import { toast } from "sonner";
import { AgentIcon } from "../lib/agentIcon";

type AgentToastArgs = {
  agent: string;
  title: string;
  body?: string;
  onActivate: () => void;
};

export function showAgentToast({
  agent,
  title,
  body,
  onActivate,
}: AgentToastArgs) {
  const hint = shortcutLabel("agent.focusAttention");
  toast(title, {
    description: hint ? (
      <span className="flex items-center gap-1.5">
        {body ? <span className="min-w-0 truncate">{body}</span> : null}
        <KbdChip className="ml-auto shrink-0">{hint}</KbdChip>
      </span>
    ) : (
      body
    ),
    icon: <AgentIcon agent={agent} size={18} />,
    action: { label: "Open", onClick: onActivate },
    duration: 6000,
  });
}
