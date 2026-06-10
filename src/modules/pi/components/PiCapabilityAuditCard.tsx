import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import {
  PiSection,
  type PiSectionShellProps,
} from "@/modules/pi/components/PiSection";
import type {
  CapabilityAuditEntry,
  CapabilityAuditSource,
} from "@/modules/pi/lib/status";
import {
  copyStatusLabel,
  useCopyToClipboard,
} from "@/modules/pi/lib/useCopyToClipboard";

export type CapabilityAuditFilter = "all" | "mcp" | "workflow" | "app" | "core";

type CapabilityAuditView = {
  filter: CapabilityAuditFilter;
  entries: CapabilityAuditEntry[];
  totalCount: number;
  mcpCount: number;
  workflowCount: number;
  appCount: number;
  coreCount: number;
  blockedCount: number;
  failedCount: number;
  succeededCount: number;
  exportText: string;
};

type PiCapabilityAuditCardProps = Pick<
  PiSectionShellProps,
  "collapsed" | "disabled" | "onCollapsedChange"
> & {
  entries: CapabilityAuditEntry[];
  expandedEntryKeys?: string[];
  filter?: CapabilityAuditFilter;
  onExpandedEntryKeysChange?: (keys: string[]) => void;
  onFilterChange?: (filter: CapabilityAuditFilter) => void;
};

const FILTER_LABELS: Record<CapabilityAuditFilter, string> = {
  all: "All",
  mcp: "MCP",
  workflow: "Flow",
  app: "App",
  core: "Core",
};

function auditSource(entry: CapabilityAuditEntry): CapabilityAuditSource {
  if (entry.toolName.startsWith("mcp__")) return "mcp";
  if (entry.toolName.startsWith("workflow.")) return "workflow";
  if (entry.toolName.startsWith("app.")) return "app";
  return "core";
}

function isMcpEntry(entry: CapabilityAuditEntry): boolean {
  return auditSource(entry) === "mcp";
}

function isWorkflowEntry(entry: CapabilityAuditEntry): boolean {
  return auditSource(entry) === "workflow";
}

function isAppEntry(entry: CapabilityAuditEntry): boolean {
  return auditSource(entry) === "app";
}

function entryMatchesFilter(
  entry: CapabilityAuditEntry,
  filter: CapabilityAuditFilter,
): boolean {
  if (filter === "all") return true;
  return auditSource(entry) === filter;
}

function outcomeDotClass(outcome: CapabilityAuditEntry["outcome"]): string {
  if (outcome === "blocked") return "bg-destructive";
  if (outcome === "failed") return "bg-muted-foreground/60";
  return "bg-foreground/65";
}

function sourceLabel(entry: CapabilityAuditEntry): string {
  const source = auditSource(entry);
  if (source === "mcp") return "MCP";
  if (source === "workflow") return "Flow";
  if (source === "app") return "App";
  return "Core";
}

function auditExportText(entries: CapabilityAuditEntry[]): string {
  return JSON.stringify({ capabilityAudit: entries }, null, 2);
}

export function auditEntryKey(entry: CapabilityAuditEntry): string {
  return `${auditSource(entry)}:${entry.sessionId}:${entry.toolCallId}:${entry.sequence}`;
}

export function buildCapabilityAuditView(
  entries: CapabilityAuditEntry[],
  filter: CapabilityAuditFilter,
): CapabilityAuditView {
  const mcpCount = entries.filter(isMcpEntry).length;
  const workflowCount = entries.filter(isWorkflowEntry).length;
  const appCount = entries.filter(isAppEntry).length;
  const filteredEntries = entries
    .filter((entry) => entryMatchesFilter(entry, filter))
    .slice()
    .reverse();

  return {
    filter,
    entries: filteredEntries,
    totalCount: entries.length,
    mcpCount,
    workflowCount,
    appCount,
    coreCount: entries.length - mcpCount - workflowCount - appCount,
    blockedCount: entries.filter((entry) => entry.outcome === "blocked").length,
    failedCount: entries.filter((entry) => entry.outcome === "failed").length,
    succeededCount: entries.filter((entry) => entry.outcome === "succeeded")
      .length,
    exportText: auditExportText(entries),
  };
}

function CapabilityAuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: CapabilityAuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 text-left"
        aria-expanded={expanded}
        onClick={onToggle}
      >
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
        <Badge
          variant={auditSource(entry) === "core" ? "outline" : "secondary"}
          className="h-4 rounded-md px-1.5 text-[9px] text-muted-foreground"
        >
          {sourceLabel(entry)}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground">
          {entry.toolName}
        </span>
        <span className="shrink-0 text-[9.5px] text-muted-foreground/65 tabular-nums">
          #{entry.sequence}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 flex min-w-0 flex-wrap gap-1 text-[9.5px] text-muted-foreground/75">
          <span className="truncate rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5">
            session {entry.sessionId}
          </span>
          <span className="truncate rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5">
            call {entry.toolCallId}
          </span>
          <span className="rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5">
            {entry.approved ? "approved" : "not approved"}
          </span>
          <span className="rounded-md border border-border/30 bg-background/65 px-1.5 py-0.5">
            {entry.allowed ? "allowed" : "blocked"}
          </span>
        </div>
      ) : null}
      {expanded && entry.message ? (
        <div className="mt-1 line-clamp-3 text-[10px] leading-snug text-muted-foreground">
          {entry.message}
        </div>
      ) : null}
    </div>
  );
}

export function PiCapabilityAuditCard({
  collapsed,
  disabled,
  entries,
  expandedEntryKeys,
  filter: controlledFilter,
  onCollapsedChange,
  onExpandedEntryKeysChange,
  onFilterChange,
}: PiCapabilityAuditCardProps) {
  const [localFilter, setLocalFilter] = useState<CapabilityAuditFilter>("all");
  const [localExpandedKeys, setLocalExpandedKeys] = useState<string[]>([]);
  const { copyText, status: copyStatus } = useCopyToClipboard();
  const filter = controlledFilter ?? localFilter;
  const expandedKeys = expandedEntryKeys ?? localExpandedKeys;
  const view = buildCapabilityAuditView(entries, filter);

  const setAuditFilter = (nextFilter: CapabilityAuditFilter) => {
    if (onFilterChange) onFilterChange(nextFilter);
    else setLocalFilter(nextFilter);
  };

  const toggleExpandedKey = (key: string) => {
    const next = expandedKeys.includes(key)
      ? expandedKeys.filter((item) => item !== key)
      : [...expandedKeys, key];
    if (onExpandedEntryKeysChange) onExpandedEntryKeysChange(next);
    else setLocalExpandedKeys(next);
  };

  return (
    <PiSection
      title="Capability audit"
      collapsed={collapsed}
      summary={
        <Badge
          variant={entries.length > 0 ? "secondary" : "outline"}
          className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
        >
          {entries.length} events
        </Badge>
      }
      actions={
        <Button
          size="xs"
          variant="ghost"
          className={cn(
            "h-5 rounded-md px-1.5 text-[10px]",
            copyStatus === "failed" && "text-destructive",
          )}
          aria-label="Copy capability audit"
          disabled={disabled || entries.length === 0}
          onClick={() => void copyText(view.exportText)}
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={copyStatus === "copied" ? CheckmarkCircle01Icon : Copy01Icon}
            strokeWidth={1.75}
          />
          {copyStatusLabel(copyStatus, "Copy")}
        </Button>
      }
      contentClassName="px-2.5 pb-2"
      onCollapsedChange={onCollapsedChange}
    >
      <div className="mb-1.5 rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-medium text-foreground">
          <HugeiconsIcon
            icon={Shield01Icon}
            size={12}
            strokeWidth={1.85}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate">Rust capability policy timeline</span>
        </div>
        <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
          Review every native tool decision, including Pi, app commands, MCP,
          workflow, approvals, blocked requests, and failures.
        </p>
      </div>

      <div className="mb-1.5 grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          MCP {view.mcpCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Flow {view.workflowCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          App {view.appCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Core {view.coreCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Blocked {view.blockedCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Failed {view.failedCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Succeeded {view.succeededCount}
        </span>
        <span className="truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Showing {view.entries.length}
        </span>
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1">
        {(Object.keys(FILTER_LABELS) as CapabilityAuditFilter[]).map(
          (nextFilter) => (
            <Button
              key={nextFilter}
              size="xs"
              variant={filter === nextFilter ? "secondary" : "outline"}
              className="h-5 rounded-md px-1.5 text-[10px]"
              aria-pressed={filter === nextFilter}
              disabled={disabled}
              onClick={() => setAuditFilter(nextFilter)}
            >
              {FILTER_LABELS[nextFilter]}
            </Button>
          ),
        )}
      </div>

      {view.entries.length > 0 ? (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-auto pr-0.5">
          {view.entries.map((entry) => {
            const key = auditEntryKey(entry);
            return (
              <CapabilityAuditRow
                key={key}
                entry={entry}
                expanded={expandedKeys.includes(key)}
                onToggle={() => toggleExpandedKey(key)}
              />
            );
          })}
        </div>
      ) : (
        <Empty className="min-h-24 gap-1.5 rounded-lg border border-border/35 bg-background/60 p-4">
          <EmptyHeader className="gap-1">
            <EmptyTitle className="text-[11.5px]">
              {entries.length === 0
                ? "No capability events yet"
                : "No events match this filter"}
            </EmptyTitle>
            <EmptyDescription className="text-[10.5px]">
              {entries.length === 0
                ? "Tool decisions will appear here after Pi or workflows use native capabilities."
                : "Switch filters to review other capability decisions."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {view.entries.length > 0 ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[9.5px] text-muted-foreground/60">
          <HugeiconsIcon
            icon={Alert02Icon}
            size={10}
            strokeWidth={1.75}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate">
            Hidden MCP tools are denied by Rust policy and recorded as blocked.
          </span>
        </div>
      ) : null}
    </PiSection>
  );
}
