import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  McpApprovalPolicy,
  McpEnvSecretStatus,
  McpServerStatus,
  McpStoredServerConfig,
  McpToolDescriptor,
} from "@/modules/pi/lib/native";
import type { CapabilityAuditEntry } from "@/modules/pi/lib/status";

export type McpServerRow = {
  id: string;
  name: string;
  commandLabel: string;
  envNames: string[];
  envSecrets: Record<string, boolean>;
  saved: boolean;
  config: McpStoredServerConfig | null;
  status: McpServerStatus | null;
  tools: McpToolDescriptor[];
};

function toolServerIds(tools: McpToolDescriptor[]): string[] {
  return [...new Set(tools.map((tool) => tool.serverId))].sort();
}

function commandLabel(config: McpStoredServerConfig | null): string {
  if (!config) return "connected runtime";
  if ((config.transport ?? "stdio") === "http") {
    return config.url ?? "HTTP MCP";
  }
  const args = config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
  return `${config.command}${args}`;
}

function envSecretKey(serverId: string, name: string): string {
  return `${serverId}\u0000${name}`;
}

export function buildServerRows(
  configs: McpStoredServerConfig[],
  tools: McpToolDescriptor[],
  statuses: McpServerStatus[],
  envSecretStatuses: McpEnvSecretStatus[],
): McpServerRow[] {
  const configMap = new Map(configs.map((config) => [config.id, config]));
  const statusMap = new Map(
    statuses.map((status) => [status.serverId, status]),
  );
  const envSecretMap = new Map(
    envSecretStatuses.map((status) => [
      envSecretKey(status.serverId, status.name),
      status.configured,
    ]),
  );
  const ids = new Set([
    ...configs.map((config) => config.id),
    ...toolServerIds(tools),
    ...statuses.map((status) => status.serverId),
  ]);
  return [...ids].sort().map((id) => {
    const config = configMap.get(id) ?? null;
    const status = statusMap.get(id) ?? null;
    const serverTools = tools.filter((tool) => tool.serverId === id);
    return {
      id,
      name:
        config?.name ?? status?.serverName ?? serverTools[0]?.serverName ?? id,
      commandLabel: commandLabel(config),
      envNames: config?.env.map((item) => item.name).sort() ?? [],
      envSecrets: Object.fromEntries(
        (config?.env ?? []).map((item) => [
          item.name,
          envSecretMap.get(envSecretKey(id, item.name)) ?? false,
        ]),
      ),
      saved: config !== null,
      config,
      status,
      tools: serverTools,
    };
  });
}

export function recentMcpAuditEntries(
  entries: CapabilityAuditEntry[],
): CapabilityAuditEntry[] {
  return entries
    .filter((entry) => entry.toolName.startsWith("mcp__"))
    .slice(-3)
    .reverse();
}

export function auditEntryKey(entry: CapabilityAuditEntry): string {
  return `mcp:${entry.sessionId}:${entry.toolCallId}:${entry.sequence}`;
}

function outcomeDotClass(outcome: CapabilityAuditEntry["outcome"]): string {
  if (outcome === "blocked") return "bg-destructive";
  if (outcome === "failed") return "bg-muted-foreground/60";
  return "bg-foreground/65";
}

function toolDisplayName(qualifiedName: string): string {
  const parts = qualifiedName.split("__");
  return parts.length >= 3 ? parts.slice(2).join("__") : qualifiedName;
}

const MCP_TOOL_POLICY_OPTIONS: McpApprovalPolicy[] = ["auto", "ask", "deny"];

function riskLabel(tool: McpToolDescriptor): string {
  return `${tool.riskLevel} risk`;
}

function McpToolRow({
  disabled,
  tool,
  onPolicyChange,
}: {
  disabled: boolean;
  tool: McpToolDescriptor;
  onPolicyChange: (
    qualifiedName: string,
    approvalPolicy: McpApprovalPolicy,
  ) => void;
}) {
  return (
    <div className="rounded-md border border-border/35 bg-background/65 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground">
          {tool.name}
        </span>
        <Badge
          variant={tool.modelVisible ? "secondary" : "outline"}
          className="h-4 rounded-md px-1.5 text-[9px] text-muted-foreground"
        >
          {tool.modelVisible ? "Enabled" : "Hidden"}
        </Badge>
        <Badge
          variant="outline"
          className="h-4 rounded-md border-border/55 px-1.5 text-[9px] text-muted-foreground"
        >
          {tool.approvalPolicy}
        </Badge>
        <Badge
          variant="outline"
          className="h-4 rounded-md border-border/55 px-1.5 text-[9px] text-muted-foreground"
          title={tool.riskReasons.join(", ")}
        >
          {riskLabel(tool)}
        </Badge>
        <div className="flex shrink-0 items-center gap-0.5">
          {MCP_TOOL_POLICY_OPTIONS.map((policy) => (
            <Button
              key={policy}
              size="xs"
              variant={tool.approvalPolicy === policy ? "secondary" : "ghost"}
              className="h-5 rounded-md px-1.5 text-[10px]"
              aria-label={`Set MCP tool ${tool.name} policy to ${policy}`}
              disabled={disabled || tool.approvalPolicy === policy}
              onClick={() => onPolicyChange(tool.qualifiedName, policy)}
            >
              {policy}
            </Button>
          ))}
        </div>
      </div>
      {tool.description ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {tool.description}
        </div>
      ) : null}
      {tool.riskReasons.length > 0 ? (
        <div className="mt-0.5 line-clamp-1 text-[9.5px] leading-snug text-muted-foreground/70">
          Risk: {tool.riskReasons.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function serverStatusLabel(status: string | null): string {
  if (status === "connected") return "Connected";
  if (status === "exited") return "Exited";
  if (status) return "Error";
  return "Saved only";
}

function serverStatusDotClass(status: string | null): string {
  if (status === "connected") return "bg-foreground/65";
  if (status === "exited") return "bg-destructive/75";
  if (status) return "bg-muted-foreground/60";
  return "bg-muted-foreground/35";
}

function McpServerStatusBadge({ status }: { status: string | null }) {
  const connected = status === "connected";
  return (
    <Badge
      variant={connected ? "secondary" : "outline"}
      className="h-4 gap-1 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", serverStatusDotClass(status))}
      />
      {serverStatusLabel(status)}
    </Badge>
  );
}

export function McpServerRow({
  disabled,
  row,
  onConnect,
  onDisconnect,
  onEdit,
  onEnvSecretRemove,
  onEnvSecretSet,
  onRemove,
  onRestart,
  onStartOAuth,
  onToolPolicyChange,
}: {
  disabled: boolean;
  row: McpServerRow;
  onConnect: (server: McpStoredServerConfig) => void;
  onDisconnect: (serverId: string) => void;
  onEdit: (server: McpStoredServerConfig) => void;
  onEnvSecretRemove: (serverId: string, name: string) => void;
  onEnvSecretSet: (serverId: string, name: string, value: string) => void;
  onRemove: (serverId: string) => void;
  onRestart: (server: McpStoredServerConfig) => void;
  onStartOAuth: (server: McpStoredServerConfig) => void;
  onToolPolicyChange: (
    qualifiedName: string,
    approvalPolicy: McpApprovalPolicy,
  ) => void;
}) {
  const effectiveStatus =
    row.status?.status ?? (row.tools.length > 0 ? "connected" : null);
  const connected = effectiveStatus === "connected";
  const exited = effectiveStatus === "exited";
  const visibleTools = exited ? [] : row.tools;
  const toolCount = row.status?.toolCount ?? visibleTools.length;
  const [secretDraft, setSecretDraft] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const submitSecretDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!secretDraft?.value) return;
    onEnvSecretSet(row.id, secretDraft.name, secretDraft.value);
    setSecretDraft(null);
  };
  return (
    <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11.5px] font-medium text-foreground">
              {row.name}
            </span>
            <McpServerStatusBadge status={effectiveStatus} />
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/70">
            {row.commandLabel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {connected ? (
            <>
              {row.config ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-5 rounded-md px-1.5 text-[10px]"
                  disabled={disabled}
                  onClick={() => onRestart(row.config as McpStoredServerConfig)}
                >
                  Restart
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="outline"
                className="h-5 rounded-md px-1.5 text-[10px]"
                disabled={disabled}
                onClick={() => onDisconnect(row.id)}
              >
                Disconnect
              </Button>
            </>
          ) : row.config ? (
            <Button
              size="xs"
              variant="secondary"
              className="h-5 rounded-md px-1.5 text-[10px]"
              disabled={disabled}
              onClick={() =>
                exited
                  ? onRestart(row.config as McpStoredServerConfig)
                  : onConnect(row.config as McpStoredServerConfig)
              }
            >
              {exited ? "Reconnect" : "Connect"}
            </Button>
          ) : null}
          {row.config ? (
            <>
              {(row.config?.transport ?? "stdio") === "http" ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-5 rounded-md px-1.5 text-[10px]"
                  aria-label={`Authorize MCP server ${row.name} with OAuth`}
                  disabled={disabled}
                  onClick={() =>
                    onStartOAuth(row.config as McpStoredServerConfig)
                  }
                >
                  OAuth
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                className="h-5 rounded-md px-1.5 text-[10px]"
                aria-label={`Edit MCP server ${row.name}`}
                disabled={disabled}
                onClick={() => onEdit(row.config as McpStoredServerConfig)}
              >
                Edit
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="h-5 rounded-md px-1.5 text-[10px] text-destructive hover:text-destructive"
                aria-label={`Remove MCP server ${row.name}`}
                disabled={disabled}
                onClick={() => onRemove(row.id)}
              >
                Remove
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap gap-1 text-[10px] text-muted-foreground/70">
        {connected || exited ? (
          <span className="truncate rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5 tabular-nums">
            {toolCount} {toolCount === 1 ? "tool" : "tools"}
          </span>
        ) : null}
        {exited &&
        row.status?.exitCode !== undefined &&
        row.status.exitCode !== null ? (
          <span className="truncate rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5 tabular-nums">
            exit {row.status.exitCode}
          </span>
        ) : null}
        {row.status?.restartBackoffMs ? (
          <span className="truncate rounded-md border border-destructive/25 bg-destructive/5 px-1.5 py-0.5 tabular-nums text-destructive">
            restart paused {Math.ceil(row.status.restartBackoffMs / 1000)}s
          </span>
        ) : null}
        {row.envNames.map((name) => {
          const configured = row.envSecrets[name] ?? false;
          return (
            <span
              key={name}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5"
            >
              <span className="truncate font-mono">{name}</span>
              <span className="shrink-0 text-muted-foreground/60">
                {configured ? "keyring set" : "env fallback"}
              </span>
              <button
                type="button"
                className="shrink-0 rounded-sm text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                disabled={disabled}
                aria-label={`Set secret value for ${name}`}
                onClick={() => setSecretDraft({ name, value: "" })}
              >
                Set
              </button>
              {configured ? (
                <button
                  type="button"
                  className="shrink-0 rounded-sm text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                  disabled={disabled}
                  aria-label={`Remove secret value for ${name}`}
                  onClick={() => onEnvSecretRemove(row.id, name)}
                >
                  Clear
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      {secretDraft ? (
        <form
          className="mt-1.5 flex min-w-0 items-end gap-1 rounded-md border border-border/35 bg-background/65 px-2 py-1.5"
          onSubmit={submitSecretDraft}
        >
          <div className="min-w-0 flex-1">
            <Label className="text-[9.5px] text-muted-foreground">
              Store value for{" "}
              <span className="font-mono">{secretDraft.name}</span>
            </Label>
            <Input
              type="password"
              value={secretDraft.value}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 h-7 font-mono text-[11px]"
              disabled={disabled}
              aria-label={`Secret value for ${secretDraft.name}`}
              onChange={(event) =>
                setSecretDraft({ ...secretDraft, value: event.target.value })
              }
            />
          </div>
          <Button
            type="submit"
            size="xs"
            variant="secondary"
            className="h-6 rounded-md px-2 text-[10px]"
            disabled={disabled || secretDraft.value.length === 0}
          >
            Save
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-6 rounded-md px-2 text-[10px]"
            disabled={disabled}
            onClick={() => setSecretDraft(null)}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {row.status?.lastFailure ? (
        <div className="mt-1 rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Last failure</span>
          <span className="mx-1 text-muted-foreground/60">·</span>
          <span className="break-words font-mono text-[9.5px]">
            {row.status.lastFailure}
          </span>
        </div>
      ) : null}
      {row.status?.stderrTail ? (
        <details className="mt-1 rounded-md border border-border/35 bg-background/65 px-2 py-1.5 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-[10px] font-medium text-foreground">
            stderr tail
          </summary>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[9.5px] leading-snug text-muted-foreground">
            {row.status.stderrTail}
          </pre>
        </details>
      ) : null}
      {visibleTools.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {visibleTools.slice(0, 3).map((tool) => (
            <McpToolRow
              key={tool.qualifiedName}
              disabled={disabled}
              tool={tool}
              onPolicyChange={onToolPolicyChange}
            />
          ))}
          {visibleTools.length > 3 ? (
            <div className="truncate text-[10px] text-muted-foreground/65">
              +{visibleTools.length - 3} more tools
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function McpAuditRow({ entry }: { entry: CapabilityAuditEntry }) {
  return (
    <div className="rounded-md border border-border/35 bg-background/65 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge
          variant="outline"
          className="h-4 gap-1 rounded-md border-border/55 px-1.5 text-[9px] text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              outcomeDotClass(entry.outcome),
            )}
          />
          {entry.outcome}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
          {toolDisplayName(entry.toolName)}
        </span>
      </div>
      {entry.message ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {entry.message}
        </div>
      ) : null}
    </div>
  );
}
