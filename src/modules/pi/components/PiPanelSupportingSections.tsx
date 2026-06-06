import type { ComponentProps } from "react";
import { PiCapabilityAuditCard } from "@/modules/pi/components/PiCapabilityAuditCard";
import { PiContextBar } from "@/modules/pi/components/PiContextBar";
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import { PiLocalAgentsCard } from "@/modules/pi/components/PiLocalAgentsCard";
import { PiMcpCard } from "@/modules/pi/components/PiMcpCard";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";

type PiPanelSupportingSectionsProps = {
  capabilityAuditCard: ComponentProps<typeof PiCapabilityAuditCard>;
  contextBar: ComponentProps<typeof PiContextBar>;
  diagnosticsCard: ComponentProps<typeof PiDiagnosticsCard>;
  hidden: boolean;
  localAgentsCard: ComponentProps<typeof PiLocalAgentsCard>;
  mcpCard: ComponentProps<typeof PiMcpCard>;
  runtimeCard: ComponentProps<typeof PiRuntimeCard>;
};

export function PiPanelSupportingSections({
  capabilityAuditCard,
  contextBar,
  diagnosticsCard,
  hidden,
  localAgentsCard,
  mcpCard,
  runtimeCard,
}: PiPanelSupportingSectionsProps) {
  if (hidden) return null;

  return (
    <>
      <PiRuntimeCard {...runtimeCard} />
      <PiLocalAgentsCard {...localAgentsCard} />
      <PiDiagnosticsCard {...diagnosticsCard} />
      <PiCapabilityAuditCard {...capabilityAuditCard} />
      <PiMcpCard {...mcpCard} />
      <PiContextBar {...contextBar} />
    </>
  );
}
