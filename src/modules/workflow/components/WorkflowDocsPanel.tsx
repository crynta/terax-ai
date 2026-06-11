import { Panel } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkflowDocument, WorkflowNode } from "../lib/schema";
import { exportWorkflowMarkdown } from "../lib/exportMarkdown";
import { workflowStatistics } from "../lib/workflowStatistics";

export function WorkflowDocsPanel({
  document,
  selectedNode,
  onClose,
}: {
  document: WorkflowDocument;
  selectedNode: WorkflowNode | null;
  onClose: () => void;
}) {
  return (
    <Panel
      position="top-right"
      className="z-50 m-2 flex max-h-[80vh] w-80 flex-col rounded-lg border border-border/60 bg-card/95 text-card-foreground shadow-xl backdrop-blur"
    >
      <div className="flex shrink-0 items-center justify-between border-border/40 border-b p-3">
        <div className="font-medium text-sm">Documentation</div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={() => {
              const md = exportWorkflowMarkdown(document);
              navigator.clipboard.writeText(md);
            }}
          >
            Copy Markdown
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={onClose}
          >
            ✕
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {!selectedNode ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-medium text-foreground">{document.title}</h3>
              <p className="mt-1 text-muted-foreground text-xs">
                Workflow overview and usage instructions. Select a node to view
                specific documentation.
              </p>
            </div>
            {document.variables && document.variables.length > 0 && (
              <div>
                <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">
                  Variables
                </h4>
                <div className="mt-1 flex flex-col gap-1">
                  {document.variables.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded border border-border/40 bg-muted/20 px-2 py-1"
                    >
                      <span className="font-mono text-[10px]">{v.name}</span>
                      <Badge variant="outline" className="text-[9px]">
                        {v.type}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">
                Statistics
              </h4>
              <StatsGrid document={document} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-foreground">
                  {selectedNode.title}
                </h3>
                <Badge variant="secondary" className="text-[10px]">
                  {selectedNode.type}
                </Badge>
              </div>
              <p className="mt-2 text-muted-foreground text-xs">
                {nodeDocumentation(selectedNode.type)}
              </p>
            </div>

            <div>
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">
                Inputs
              </h4>
              {selectedNode.inputs.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1">
                  {selectedNode.inputs.map((port) => (
                    <div
                      key={port.id}
                      className="flex items-center gap-2 rounded border border-border/40 bg-muted/20 px-2 py-1"
                    >
                      <Badge variant="outline" className="text-[9px]">
                        {port.type}
                      </Badge>
                      <span className="text-xs">{port.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-muted-foreground text-xs italic">
                  No inputs
                </div>
              )}
            </div>

            <div>
              <h4 className="font-medium text-foreground text-xs uppercase tracking-wide">
                Outputs
              </h4>
              {selectedNode.outputs.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1">
                  {selectedNode.outputs.map((port) => (
                    <div
                      key={port.id}
                      className="flex items-center gap-2 rounded border border-border/40 bg-muted/20 px-2 py-1"
                    >
                      <Badge variant="outline" className="text-[9px]">
                        {port.type}
                      </Badge>
                      <span className="text-xs">{port.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-muted-foreground text-xs italic">
                  No outputs
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function nodeDocumentation(type: string): string {
  switch (type) {
    case "textPrompt":
      return "Provides a static text string. Resolves {{variables.x}} and {{node.id}} expressions.";
    case "textTransform":
      return "Transforms text or JSON using a template. Use {{input}} for the first input, {{text}} for the first text input, and {{json.path}} to extract from JSON.";
    case "jsonExtract":
      return "Extracts a value from JSON using a dot-notation path (e.g. data.items.0.name).";
    case "jsonBuild":
      return "Builds a JSON object by merging inputs. If a key is provided, inputs are nested under that key.";
    case "if":
      return "Routes execution based on a condition. Unmatched branches are never executed.";
    case "switch":
      return "Routes execution to multiple branches based on text patterns. Routes to 'default' if no cases match.";
    case "merge":
      return "Combines multiple text inputs into a single text output, separated by the configured separator.";
    case "retry":
      return "Re-executes its upstream source node if it fails, up to maxAttempts times, with an optional delay.";
    case "errorBranch":
      return "Captures failure from an upstream node and provides the error message as an artifact.";
    case "forEach":
      return "Takes a JSON array and produces one artifact per item. Execution engine fans out downstream nodes.";
    case "setVariable":
      return "Stores the input value in a document-level variable that can be read anywhere via {{variables.name}}.";
    case "getVariable":
      return "Reads a document-level variable and outputs it as text.";
    case "delay":
      return "Waits for the specified number of seconds before passing the input through.";
    case "webhook":
      return "Starts the workflow when an HTTP request arrives. Outputs the body and headers.";
    case "schedule":
      return "Starts the workflow on a schedule using a cron expression.";
    case "agent":
      return "Runs an autonomous AI agent to perform a task. Requires explicit approval if safety is enabled.";
    case "browserAutomation":
      return "Controls a headless browser to extract data or interact with pages. Requires explicit approval.";
    case "shellCommand":
      return "Executes a shell command on the host. Requires explicit approval if safety is enabled.";
    case "httpRequest":
      return "Sends an HTTP request. Resolves expressions in URL and headers before sending.";
    case "imageGeneration":
    case "videoGeneration":
    case "audioGeneration":
      return "Generates media using an AI provider. Connect a prompt to control the output.";
    default:
      return "No documentation available.";
  }
}

function StatsGrid({ document }: { document: WorkflowDocument }) {
  const stats = workflowStatistics(document);
  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-1.5">
        <StatCard label="Nodes" value={stats.nodeCount} />
        <StatCard label="Edges" value={stats.edgeCount} />
        <StatCard label="Artifacts" value={stats.artifactCount} />
        <StatCard label="Variables" value={stats.variableCount} />
        <StatCard label="Runs" value={stats.runCount} />
        <StatCard
          label="Duration"
          value={stats.totalDurationFormatted ?? "—"}
        />
      </div>

      {/* Status breakdown */}
      <div className="mt-1">
        <h5 className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wider">
          Status
        </h5>
        <div className="flex flex-wrap gap-1">
          {Object.entries(stats.statusCounts).map(([status, count]) => (
            <Badge
              key={status}
              variant={
                status === "completed"
                  ? "default"
                  : status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="text-[9px]"
            >
              {status}: {count}
            </Badge>
          ))}
          {Object.keys(stats.statusCounts).length === 0 && (
            <span className="text-muted-foreground text-[10px] italic">
              All idle
            </span>
          )}
        </div>
      </div>

      {/* Node types breakdown */}
      <div className="mt-1">
        <h5 className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wider">
          Node Types
        </h5>
        <div className="flex flex-wrap gap-1">
          {Object.entries(stats.nodeTypeCounts).map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-[9px]">
              {type}
              {count > 1 ? ` ×${count}` : ""}
            </Badge>
          ))}
        </div>
      </div>

      {/* Safety warning */}
      {stats.unsafeNodeCount > 0 && (
        <div className="mt-1 rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[10px] text-yellow-700">
          ⚠ {stats.unsafeNodeCount} unsafe node
          {stats.unsafeNodeCount > 1 ? "s" : ""} (require approval)
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-border/40 bg-muted/20 px-2 py-1.5">
      <div className="text-muted-foreground text-[9px] uppercase tracking-wider">
        {label}
      </div>
      <div className="font-medium text-foreground text-sm">{value}</div>
    </div>
  );
}
