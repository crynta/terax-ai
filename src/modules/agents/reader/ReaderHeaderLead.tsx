import { AgentIcon } from "@/modules/agents/lib/agentIcon";

/**
 * The agent's icon at the start of the Reader header. Hosts can swap this
 * module (the VS Code extension makes it its theme switch).
 */
export function ReaderHeaderLead({ agent }: { agent: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
      <AgentIcon agent={agent} size={15} />
    </span>
  );
}
