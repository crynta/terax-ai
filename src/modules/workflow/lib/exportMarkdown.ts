import type { WorkflowDocument, WorkflowRunHistoryEntry } from "./schema";
import { nodeSubtitle } from "../components/WorkflowCanvasMetadata";

/**
 * Generate a Markdown description of the workflow.
 * Useful for documentation, sharing, and AI consumption.
 */
export function exportWorkflowMarkdown(document: WorkflowDocument): string {
  const lines: string[] = [];
  lines.push(`# ${document.title}`);
  lines.push("");
  lines.push(`**ID:** ${document.id}`);
  lines.push(`**Version:** ${document.version}`);
  lines.push(`**Nodes:** ${document.nodes.length}`);
  lines.push(`**Connections:** ${document.edges.length}`);
  if (document.variables.length > 0) {
    lines.push(
      `**Variables:** ${document.variables.map((v) => v.name).join(", ")}`,
    );
  }
  lines.push("");

  lines.push("## Nodes");
  lines.push("");
  for (const node of document.nodes) {
    lines.push(`### ${node.title} (\`${node.type}\`)`);
    lines.push(`- **ID:** ${node.id}`);
    lines.push(`- **Position:** ${node.position.x}, ${node.position.y}`);
    if (nodeSubtitle(node) !== node.type) {
      lines.push(`- **Subtitle:** ${nodeSubtitle(node)}`);
    }
    if (node.inputs.length > 0) {
      lines.push(
        `- **Inputs:** ${node.inputs.map((p) => `${p.label} (${p.type})`).join(", ")}`,
      );
    }
    if (node.outputs.length > 0) {
      lines.push(
        `- **Outputs:** ${node.outputs.map((p) => `${p.label} (${p.type})`).join(", ")}`,
      );
    }
    const configKeys = Object.keys(node.config);
    if (configKeys.length > 0) {
      lines.push("- **Config:**");
      for (const key of configKeys) {
        const val = node.config[key];
        if (val !== undefined && val !== "") {
          const display =
            typeof val === "string" && val.length > 100
              ? `${val.slice(0, 100)}\u2026`
              : String(val);
          lines.push(`  - \`${key}\`: ${display}`);
        }
      }
    }
    lines.push("");
  }

  if (document.edges.length > 0) {
    lines.push("## Connections");
    lines.push("");
    const nodeById = new Map(document.nodes.map((n) => [n.id, n]));
    for (const edge of document.edges) {
      const src = nodeById.get(edge.sourceNodeId);
      const tgt = nodeById.get(edge.targetNodeId);
      const srcLabel = src ? src.title : edge.sourceNodeId;
      const tgtLabel = tgt ? tgt.title : edge.targetNodeId;
      lines.push(
        `- ${srcLabel} (${edge.sourcePortId}) \u2192 ${tgtLabel} (${edge.targetPortId})`,
      );
    }
    lines.push("");
  }

  if (document.runHistory && document.runHistory.length > 0) {
    lines.push("## Run History");
    lines.push("");
    lines.push("| # | Status | Nodes | Started | Finished |");
    lines.push("|---|--------|-------|---------|----------|");
    document.runHistory.forEach((run: WorkflowRunHistoryEntry, i: number) => {
      lines.push(
        `| ${i + 1} | ${run.status} | ${run.completedCount}/${run.nodeCount} | ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "\u2014"} | ${run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "\u2014"} |`,
      );
    });
    lines.push("");
  }

  return lines.join("\n");
}
