import { Panel } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WorkflowInspectorState } from "../lib/inspector";
import {
  approvalActionText,
  formatLogTimestamp,
  formatPercent,
} from "./WorkflowCanvasArtifacts";

export function WorkflowInspectorPanel({
  state,
}: {
  state: WorkflowInspectorState;
}) {
  const errors = state.issues.filter((issue) => issue.severity === "error");
  const warnings = state.issues.filter((issue) => issue.severity === "warning");
  const visibleIssues = state.issues.slice(0, 4);

  return (
    <Panel
      position="bottom-right"
      className="max-w-80 rounded-lg border border-border/60 bg-card/95 p-2 text-card-foreground shadow-lg backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Inspector
        </div>
        <div className="flex items-center gap-1">
          <Badge
            variant={errors.length > 0 ? "destructive" : "secondary"}
            className="text-[10px]"
          >
            {errors.length} errors
          </Badge>
          {warnings.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              {warnings.length} warnings
            </Badge>
          ) : null}
        </div>
      </div>
      {state.selectedNode ? (
        <div className="mb-2 space-y-2 rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
          <div>
            <div className="truncate font-medium">
              {state.selectedNode.title}
            </div>
            <div className="mt-1 text-muted-foreground">
              {state.selectedNode.type} · {state.selectedNode.status} ·{" "}
              {state.selectedNode.inputCount} in /{" "}
              {state.selectedNode.outputCount} out
            </div>
          </div>
          {state.selectedNode.message ? (
            <div className="rounded border border-border/50 bg-background/60 px-2 py-1 text-muted-foreground">
              {state.selectedNode.message}
            </div>
          ) : null}
          {typeof state.selectedNode.progress === "number" ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-muted-foreground text-[10px] uppercase tracking-wide">
                <span>Progress</span>
                <span>{formatPercent(state.selectedNode.progress)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: formatPercent(state.selectedNode.progress),
                  }}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {state.selectedNode.errorCode ? (
              <Badge variant="destructive" className="text-[10px]">
                {state.selectedNode.errorCode}
              </Badge>
            ) : null}
            {state.selectedNode.attempt ? (
              <Badge variant="outline" className="text-[10px]">
                attempt {state.selectedNode.attempt}
              </Badge>
            ) : null}
            {state.selectedNode.artifactIds.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {state.selectedNode.artifactIds.length} artifacts
              </Badge>
            ) : null}
          </div>
          {state.selectedNode.approval ? (
            <div className="space-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
              <div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Approval required
              </div>
              <div className="line-clamp-2 text-muted-foreground">
                {state.selectedNode.approval.risk}
              </div>
              <div className="truncate font-mono text-[10px]">
                {approvalActionText(state.selectedNode.approval.action)}
              </div>
            </div>
          ) : null}
          {state.selectedNode.recentLogs.length > 0 ? (
            <div className="space-y-1">
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                Runtime log
              </div>
              {state.selectedNode.recentLogs.map((log, index) => (
                <div
                  key={`${log.event}-${log.at ?? index}-${index}`}
                  className="rounded border border-border/40 bg-background/50 px-2 py-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{log.event}</span>
                    {log.at ? (
                      <span className="text-muted-foreground text-[10px]">
                        {formatLogTimestamp(log.at)}
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-muted-foreground">
                    {log.message}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mb-2 text-muted-foreground text-xs">
          Select a node for details.
        </div>
      )}
      {visibleIssues.length > 0 ? (
        <div className="space-y-1">
          {visibleIssues.map((issue, index) => (
            <div
              key={`${issue.severity}-${issue.nodeId ?? "graph"}-${index}`}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                issue.severity === "error" &&
                  "border-destructive/30 bg-destructive/10 text-destructive",
                issue.severity === "warning" &&
                  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                issue.severity === "info" &&
                  "border-border/60 bg-muted/20 text-muted-foreground",
              )}
            >
              {issue.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-muted-foreground text-xs">
          No validation issues.
        </div>
      )}
    </Panel>
  );
}
