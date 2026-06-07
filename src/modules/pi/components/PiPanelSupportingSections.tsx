import { type ComponentProps, createContext, type ReactNode, use } from "react";
import { PiCapabilityAuditCard } from "@/modules/pi/components/PiCapabilityAuditCard";
import { PiContextBar } from "@/modules/pi/components/PiContextBar";
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import { PiLocalAgentsCard } from "@/modules/pi/components/PiLocalAgentsCard";
import { PiMcpCard } from "@/modules/pi/components/PiMcpCard";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";

type PiPanelSupportingSectionsState = {
  capabilityAuditCard: ComponentProps<typeof PiCapabilityAuditCard>;
  contextBar: ComponentProps<typeof PiContextBar>;
  diagnosticsCard: ComponentProps<typeof PiDiagnosticsCard>;
  localAgentsCard: ComponentProps<typeof PiLocalAgentsCard>;
  mcpCard: ComponentProps<typeof PiMcpCard>;
  runtimeCard: ComponentProps<typeof PiRuntimeCard>;
};

type PiPanelSupportingSectionsContextValue = {
  state: PiPanelSupportingSectionsState;
};

const PiPanelSupportingSectionsContext =
  createContext<PiPanelSupportingSectionsContextValue | null>(null);

export function PiPanelSupportingSectionsProvider({
  children,
  state,
}: PiPanelSupportingSectionsContextValue & { children: ReactNode }) {
  return (
    <PiPanelSupportingSectionsContext.Provider value={{ state }}>
      {children}
    </PiPanelSupportingSectionsContext.Provider>
  );
}

function usePiPanelSupportingSections(): PiPanelSupportingSectionsContextValue {
  const context = use(PiPanelSupportingSectionsContext);
  if (!context) {
    throw new Error(
      "PiPanelSupportingSections must be used within PiPanelSupportingSectionsProvider",
    );
  }
  return context;
}

function PiPanelRuntimeSection() {
  const {
    state: { runtimeCard },
  } = usePiPanelSupportingSections();

  return <PiRuntimeCard {...runtimeCard} />;
}

function PiPanelLocalAgentsSection() {
  const {
    state: { localAgentsCard },
  } = usePiPanelSupportingSections();

  return <PiLocalAgentsCard {...localAgentsCard} />;
}

function PiPanelDiagnosticsSection() {
  const {
    state: { diagnosticsCard },
  } = usePiPanelSupportingSections();

  return <PiDiagnosticsCard {...diagnosticsCard} />;
}

function PiPanelCapabilityAuditSection() {
  const {
    state: { capabilityAuditCard },
  } = usePiPanelSupportingSections();

  return <PiCapabilityAuditCard {...capabilityAuditCard} />;
}

function PiPanelMcpSection() {
  const {
    state: { mcpCard },
  } = usePiPanelSupportingSections();

  return <PiMcpCard {...mcpCard} />;
}

function PiPanelContextSection() {
  const {
    state: { contextBar },
  } = usePiPanelSupportingSections();

  return <PiContextBar {...contextBar} />;
}

function PiPanelSupportingSectionsRoot() {
  return (
    <>
      <PiPanelSupportingSections.Runtime />
      <PiPanelSupportingSections.LocalAgents />
      <PiPanelSupportingSections.Diagnostics />
      <PiPanelSupportingSections.CapabilityAudit />
      <PiPanelSupportingSections.Mcp />
      <PiPanelSupportingSections.Context />
    </>
  );
}

export const PiPanelSupportingSections = Object.assign(
  PiPanelSupportingSectionsRoot,
  {
    CapabilityAudit: PiPanelCapabilityAuditSection,
    Context: PiPanelContextSection,
    Diagnostics: PiPanelDiagnosticsSection,
    LocalAgents: PiPanelLocalAgentsSection,
    Mcp: PiPanelMcpSection,
    Runtime: PiPanelRuntimeSection,
  },
);
