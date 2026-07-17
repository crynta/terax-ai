import i18n from "@/i18n";
import { shortcutLabel } from "@/modules/shortcuts";
import { toast } from "sonner";
import { AgentIcon } from "../lib/agentIcon";

type AgentToastArgs = {
  agent: string;
  title: string;
  body?: string;
  onActivate: () => void;
};

export function showAgentToast({ agent, title, body, onActivate }: AgentToastArgs) {
  const hint = shortcutLabel("agent.focusAttention");
  toast(title, {
    description: hint ? (
      <span className="flex items-center gap-1.5">
        {body ? <span className="min-w-0 truncate">{body}</span> : null}
        <kbd className="ml-auto shrink-0 rounded border border-border/60 bg-muted/60 px-1 py-px text-[10px] font-medium text-muted-foreground">
          {hint}
        </kbd>
      </span>
    ) : (
      body
    ),
    icon: <AgentIcon agent={agent} size={18} />,
    action: { label: i18n.t("agents:toast.open"), onClick: onActivate },
    duration: 6000,
  });
}
