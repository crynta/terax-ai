import { useState, useMemo } from "react";
import { Panel } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { preRunValidation, type PreRunIssue } from "../lib/preRunValidation";
import type { WorkflowDocument } from "../lib/schema";

function severityIcon(severity: PreRunIssue["severity"]): string {
  if (severity === "error") return "✕";
  if (severity === "warning") return "⚠";
  return "ℹ";
}

export function WorkflowValidationPanel({
  document,
}: {
  document: WorkflowDocument;
}) {
  const [expanded, setExpanded] = useState(false);
  const issues = useMemo(() => preRunValidation(document), [document]);

  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  return (
    <Panel
      position="top-right"
      className="max-w-72 rounded-lg border border-border/60 bg-card/95 text-card-foreground shadow-lg backdrop-blur"
      style={{ marginTop: expanded ? undefined : 0 }}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 p-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-1.5">
          {errors.length > 0 && (
            <Badge variant="destructive" className="text-[9px]">
              {errors.length} error{errors.length > 1 ? "s" : ""}
            </Badge>
          )}
          {warnings.length > 0 && (
            <Badge variant="secondary" className="text-[9px]">
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </Badge>
          )}
          {infos.length > 0 && errors.length === 0 && warnings.length === 0 && (
            <Badge variant="outline" className="text-[9px]">
              {infos.length} note{infos.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <span className="text-muted-foreground text-[10px]">
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-border/40 border-t px-2 py-1.5">
          {issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5 text-[11px]">
              <span
                className={
                  issue.severity === "error"
                    ? "text-destructive"
                    : issue.severity === "warning"
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-muted-foreground"
                }
              >
                {severityIcon(issue.severity)}
              </span>
              <span className="text-muted-foreground">{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
