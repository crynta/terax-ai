import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type FormEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { McpConfigEditor } from "@/modules/pi/components/PiMcpConfigEditor";
import {
  buildMcpServerConfigFromDraft,
  draftFromStoredMcpConfig,
  EMPTY_MCP_CONFIG_DRAFT,
  type McpConfigDraft,
} from "@/modules/pi/components/PiMcpConfig";
import {
  auditEntryKey,
  buildServerRows,
  McpAuditRow,
  McpServerRow,
  recentMcpAuditEntries,
} from "@/modules/pi/components/PiMcpRows";
import { PiSection } from "@/modules/pi/components/PiSection";
import type {
  McpApprovalPolicy,
  McpEnvSecretStatus,
  McpServerConfig,
  McpServerStatus,
  McpStoredServerConfig,
  McpToolDescriptor,
} from "@/modules/pi/lib/native";
import type { CapabilityAuditEntry } from "@/modules/pi/lib/status";

export type { McpConfigDraft } from "@/modules/pi/components/PiMcpConfig";
export {
  buildMcpServerConfigFromDraft,
  draftFromStoredMcpConfig,
} from "@/modules/pi/components/PiMcpConfig";

type PiMcpCardProps = {
  auditEntries: CapabilityAuditEntry[];
  collapsed: boolean;
  configs: McpStoredServerConfig[];
  disabled: boolean;
  error: string | null;
  envSecretStatuses: McpEnvSecretStatus[];
  isRefreshing: boolean;
  statuses: McpServerStatus[];
  tools: McpToolDescriptor[];
  onCollapsedChange: (collapsed: boolean) => void;
  onConnect: (server: McpStoredServerConfig) => void;
  onDisconnect: (serverId: string) => void;
  onEnvSecretRemove: (serverId: string, name: string) => void;
  onEnvSecretSet: (serverId: string, name: string, value: string) => void;
  onRefresh: () => void;
  onRemoveConfig: (serverId: string) => void;
  onRestart: (server: McpStoredServerConfig) => void;
  onSaveConfig: (config: McpServerConfig) => void;
  onStartOAuth: (server: McpStoredServerConfig) => void;
  onToolPolicyChange: (
    qualifiedName: string,
    approvalPolicy: McpApprovalPolicy,
  ) => void;
};

export function PiMcpCard({
  auditEntries,
  collapsed,
  configs,
  disabled,
  envSecretStatuses,
  error,
  isRefreshing,
  statuses,
  tools,
  onCollapsedChange,
  onConnect,
  onDisconnect,
  onEnvSecretRemove,
  onEnvSecretSet,
  onRefresh,
  onRemoveConfig,
  onRestart,
  onSaveConfig,
  onStartOAuth,
  onToolPolicyChange,
}: PiMcpCardProps) {
  const rows = buildServerRows(configs, tools, statuses, envSecretStatuses);
  const connectedCount = rows.filter(
    (row) =>
      (row.status?.status ?? (row.tools.length > 0 ? "connected" : null)) ===
      "connected",
  ).length;
  const recentAudit = recentMcpAuditEntries(auditEntries);
  const [draft, setDraft] = useState<McpConfigDraft>(EMPTY_MCP_CONFIG_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const resetEditor = () => {
    setDraft(EMPTY_MCP_CONFIG_DRAFT);
    setEditingId(null);
    setValidationError(null);
  };

  const editConfig = (config: McpStoredServerConfig) => {
    setDraft(draftFromStoredMcpConfig(config));
    setEditingId(config.id);
    setValidationError(null);
  };

  const submitConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = buildMcpServerConfigFromDraft(draft);
    if (!result.ok) {
      setValidationError(result.error);
      return;
    }
    setValidationError(null);
    onSaveConfig(result.config);
    resetEditor();
  };

  return (
    <PiSection
      title="MCP servers"
      collapsed={collapsed}
      summary={
        <Badge
          variant="outline"
          className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
        >
          {connectedCount}/{rows.length || configs.length}
        </Badge>
      }
      actions={
        <Button
          size="xs"
          variant="ghost"
          className="h-5 rounded-md px-1.5 text-[10px]"
          disabled={disabled || isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? (
            <Spinner className="size-2.5" />
          ) : (
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.75} />
          )}
          Refresh
        </Button>
      }
      onCollapsedChange={onCollapsedChange}
    >
      <div className="flex flex-col gap-2 px-2 pb-2">
        <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-medium text-foreground">
            <Badge
              variant="secondary"
              className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
            >
              Rust broker
            </Badge>
            <span>Editable tool approval policy</span>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            MCP tools route through nativeTools.execute, Rust approval policy,
            and capability audit before stdio or HTTP server calls run.
          </p>
        </div>

        {error ? (
          <Alert
            variant="destructive"
            className="rounded-lg border-destructive/35 px-2.5 py-2"
          >
            <div className="flex min-w-0 items-start gap-1.5">
              <HugeiconsIcon
                icon={Alert02Icon}
                size={12}
                strokeWidth={1.85}
                className="mt-0.5 shrink-0 text-destructive"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-foreground">
                  MCP action failed
                </div>
                <div className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
                  {error}
                </div>
              </div>
            </div>
          </Alert>
        ) : null}

        {rows.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <McpServerRow
                key={row.id}
                disabled={disabled || isRefreshing}
                row={row}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onEdit={editConfig}
                onEnvSecretRemove={onEnvSecretRemove}
                onEnvSecretSet={onEnvSecretSet}
                onRemove={onRemoveConfig}
                onRestart={onRestart}
                onStartOAuth={onStartOAuth}
                onToolPolicyChange={onToolPolicyChange}
              />
            ))}
          </div>
        ) : (
          <Empty className="min-h-24 gap-1.5 rounded-lg border border-border/35 bg-background/60 p-4">
            <EmptyHeader className="gap-1">
              <EmptyTitle className="text-[11.5px]">
                No MCP servers saved
              </EmptyTitle>
              <EmptyDescription className="text-[10.5px]">
                Save stdio or HTTP MCP configs to broker tools through Rust
                policy.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <McpConfigEditor
          disabled={disabled || isRefreshing}
          draft={draft}
          editingId={editingId}
          error={validationError}
          onCancelEdit={resetEditor}
          onDraftChange={setDraft}
          onSubmit={submitConfig}
        />

        {recentAudit.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                size={11}
                strokeWidth={1.85}
                className="shrink-0"
              />
              Recent policy
            </div>
            {recentAudit.map((entry) => (
              <McpAuditRow key={auditEntryKey(entry)} entry={entry} />
            ))}
          </div>
        ) : null}
      </div>
    </PiSection>
  );
}
