import { toast } from "sonner";
import { AgentIcon } from "../lib/agentIcon";

type AgentToastArgs = {
  agent: string;
  title: string;
  body?: string;
  onActivate: () => void;
};

export function showAgentToast({ agent, title, body, onActivate }: AgentToastArgs) {
  toast(title, {
    description: body,
    icon: <AgentIcon agent={agent} size={18} />,
    action: { label: "Open", onClick: onActivate },
    duration: 6000,
  });
}
