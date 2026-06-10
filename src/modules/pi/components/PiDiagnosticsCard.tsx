import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PiSection } from "@/modules/pi/components/PiSection";
import type { PiSectionShellProps } from "@/modules/pi/components/PiSection";
import type {
  PiDiagnosticsAction,
  PiDiagnosticsIssue,
  PiDiagnosticsView,
} from "@/modules/pi/lib/diagnostics";
import {
  copyStatusLabel,
  useCopyToClipboard,
} from "@/modules/pi/lib/useCopyToClipboard";

type PiDiagnosticsCardProps = PiSectionShellProps & {
  view: PiDiagnosticsView;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onRestartRuntime: () => void;
  onStartRuntime: () => void;
};

function actionHandler(
  action: PiDiagnosticsAction | null,
  props: Pick<
    PiDiagnosticsCardProps,
    "onOpenSettings" | "onRefresh" | "onRestartRuntime" | "onStartRuntime"
  >,
): (() => void) | null {
  switch (action) {
    case "open-settings":
      return props.onOpenSettings;
    case "refresh":
      return props.onRefresh;
    case "restart-runtime":
      return props.onRestartRuntime;
    case "start-runtime":
      return props.onStartRuntime;
    case null:
      return null;
  }
}

function IssueAction({
  disabled,
  issue,
  onOpenSettings,
  onRefresh,
  onRestartRuntime,
  onStartRuntime,
}: {
  disabled: boolean;
  issue: PiDiagnosticsIssue;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onRestartRuntime: () => void;
  onStartRuntime: () => void;
}) {
  const handler = actionHandler(issue.action, {
    onOpenSettings,
    onRefresh,
    onRestartRuntime,
    onStartRuntime,
  });
  if (!handler || !issue.actionLabel) return null;

  return (
    <Button
      size="xs"
      variant={issue.tone === "destructive" ? "outline" : "secondary"}
      className="h-5 shrink-0 rounded-md px-1.5 text-[10px]"
      disabled={disabled}
      onClick={handler}
    >
      {issue.action === "open-settings" ? (
        <HugeiconsIcon
          data-icon="inline-start"
          icon={Settings01Icon}
          strokeWidth={1.75}
        />
      ) : null}
      {issue.actionLabel}
    </Button>
  );
}

function IssueRow({
  disabled,
  issue,
  onOpenSettings,
  onRefresh,
  onRestartRuntime,
  onStartRuntime,
}: {
  disabled: boolean;
  issue: PiDiagnosticsIssue;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onRestartRuntime: () => void;
  onStartRuntime: () => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-1.5">
        <HugeiconsIcon
          icon={
            issue.tone === "destructive" ? Alert02Icon : CheckmarkCircle01Icon
          }
          size={12}
          strokeWidth={1.85}
          className={cn(
            "mt-0.5 shrink-0",
            issue.tone === "destructive"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-foreground">
            {issue.title}
          </div>
          <div className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
            {issue.description}
          </div>
        </div>
        <IssueAction
          disabled={disabled}
          issue={issue}
          onOpenSettings={onOpenSettings}
          onRefresh={onRefresh}
          onRestartRuntime={onRestartRuntime}
          onStartRuntime={onStartRuntime}
        />
      </div>
    </>
  );

  if (issue.tone === "destructive") {
    return (
      <Alert
        variant="destructive"
        className="rounded-lg border-destructive/35 px-2.5 py-2"
      >
        {content}
      </Alert>
    );
  }

  return (
    <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
      {content}
    </div>
  );
}

export function PiDiagnosticsCard({
  collapsed,
  disabled,
  refreshing,
  view,
  onCollapsedChange,
  onOpenSettings,
  onRefresh,
  onRestartRuntime,
  onStartRuntime,
}: PiDiagnosticsCardProps) {
  const { copyText, status: copyStatus } = useCopyToClipboard();
  const hasSettingsAction = view.issues.some(
    (issue) => issue.action === "open-settings",
  );

  return (
    <PiSection
      title="Diagnostics"
      collapsed={collapsed}
      summary={
        <Badge
          variant={view.healthy ? "secondary" : "outline"}
          className="h-4 gap-1 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              view.healthy ? "bg-foreground/65" : "bg-muted-foreground/40",
            )}
          />
          {view.healthy ? "Healthy" : "Review"}
        </Badge>
      }
      actions={
        <>
          <Button
            size="xs"
            variant="ghost"
            className="h-5 rounded-md px-1.5 text-[10px]"
            disabled={disabled}
            onClick={onRefresh}
          >
            {refreshing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <HugeiconsIcon
                data-icon="inline-start"
                icon={Refresh01Icon}
                strokeWidth={1.75}
              />
            )}
            Refresh
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className={cn(
              "h-5 rounded-md px-1.5 text-[10px]",
              copyStatus === "failed" && "text-destructive",
            )}
            aria-label="Copy Pi diagnostics"
            disabled={disabled}
            onClick={() => void copyText(view.diagnosticsText)}
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={
                copyStatus === "copied" ? CheckmarkCircle01Icon : Copy01Icon
              }
              strokeWidth={1.75}
            />
            {copyStatusLabel(copyStatus, "Copy")}
          </Button>
          {hasSettingsAction ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-5 rounded-md px-1.5 text-[10px]"
              disabled={disabled}
              onClick={onOpenSettings}
            >
              <HugeiconsIcon
                data-icon="inline-start"
                icon={Settings01Icon}
                strokeWidth={1.75}
              />
              Settings
            </Button>
          ) : null}
        </>
      }
      contentClassName="px-2.5 pb-2"
      onCollapsedChange={onCollapsedChange}
    >
      <div
        className={cn(
          "mb-1.5 rounded-lg border px-2.5 py-2",
          view.healthy
            ? "border-border/35 bg-card/60"
            : "border-border/45 bg-background/80",
        )}
      >
        <div className="truncate text-[11px] font-medium text-foreground">
          {view.summaryTitle}
        </div>
        <div className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
          {view.summaryDescription}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Packages {view.loadedPackageCount}/{view.packageCount}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 text-right">
          Provider {view.providerLabel}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1">
          Model {view.modelLabel}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 text-right">
          Key {view.providerKeyLabel}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Sessions {view.sessionCount}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 text-right">
          {view.capabilityLabel}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 tabular-nums">
          Methods {view.methodCount}
        </span>
        <span className="min-w-0 truncate rounded-md border border-border/35 bg-background/70 px-1.5 py-1 text-right tabular-nums">
          Limit {view.promptLimitLabel}
        </span>
      </div>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {view.healthy ? (
          <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/35 bg-card/60 px-2.5 py-2 text-[10.5px] text-muted-foreground">
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              size={12}
              strokeWidth={1.85}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate">
              Pi packages, key presence, and session storage look ready.
            </span>
          </div>
        ) : (
          view.issues.map((issue) => (
            <IssueRow
              key={issue.id}
              disabled={disabled}
              issue={issue}
              onOpenSettings={onOpenSettings}
              onRefresh={onRefresh}
              onRestartRuntime={onRestartRuntime}
              onStartRuntime={onStartRuntime}
            />
          ))
        )}
        {view.debugDetail ? (
          <details className="rounded-lg border border-border/35 bg-card/50 px-2.5 py-2 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer select-none text-[10.5px] font-medium text-foreground">
              Sidecar stderr tail
            </summary>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[9.5px] leading-snug text-muted-foreground">
              {view.debugDetail}
            </pre>
          </details>
        ) : null}
        <div className="truncate text-[9.5px] text-muted-foreground/60">
          Node {view.nodeLabel} · Storage {view.storageLabel} ·{" "}
          {view.idlePolicyLabel}
        </div>
      </div>
    </PiSection>
  );
}
