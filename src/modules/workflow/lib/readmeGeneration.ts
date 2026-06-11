import type { WorkflowDocument } from "./schema";

/**
 * Generate a README-style Markdown document from a workflow.
 */
export function generateWorkflowReadme(document: WorkflowDocument): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${document.title}`);
  lines.push("");

  // Overview
  lines.push("## Overview");
  lines.push("");
  lines.push(
    `This workflow has **${document.nodes.length} nodes** and **${document.edges.length} connections**.`,
  );
  if (document.variables.length > 0) {
    lines.push(`It uses **${document.variables.length} variables**.`);
  }
  lines.push("");

  // Nodes
  if (document.nodes.length > 0) {
    lines.push("## Nodes");
    lines.push("");
    lines.push("| # | Name | Type | Status |");
    lines.push("|---|------|------|--------|");
    document.nodes.forEach((node, i) => {
      const status = node.runtimeState.status;
      lines.push(`| ${i + 1} | ${node.title} | \`${node.type}\` | ${status} |`);
    });
    lines.push("");
  }

  // Connections
  if (document.edges.length > 0) {
    lines.push("## Connections");
    lines.push("");
    lines.push("| Source | Port | → | Target | Port |");
    lines.push("|--------|------|---|--------|------|");
    document.edges.forEach((edge) => {
      const src = document.nodes.find((n) => n.id === edge.sourceNodeId);
      const tgt = document.nodes.find((n) => n.id === edge.targetNodeId);
      lines.push(
        `| ${src?.title ?? edge.sourceNodeId} | ${edge.sourcePortId} | → | ${tgt?.title ?? edge.targetNodeId} | ${edge.targetPortId} |`,
      );
    });
    lines.push("");
  }

  // Variables
  if (document.variables.length > 0) {
    lines.push("## Variables");
    lines.push("");
    lines.push("| Name | Type | Value |");
    lines.push("|------|------|-------|");
    document.variables.forEach((v) => {
      const value =
        typeof v.value === "string" ? v.value : JSON.stringify(v.value ?? "");
      lines.push(`| ${v.name} | ${v.type} | ${value.slice(0, 50)} |`);
    });
    lines.push("");
  }

  // Node details
  lines.push("## Node Details");
  lines.push("");
  document.nodes.forEach((node) => {
    lines.push(`### ${node.title}`);
    lines.push("");
    lines.push(`- **Type:** \`${node.type}\``);
    lines.push(`- **Position:** (${node.position.x}, ${node.position.y})`);

    if (node.inputs.length > 0) {
      lines.push("- **Inputs:**");
      for (const p of node.inputs) {
        lines.push(`  - \`${p.id}\` (${p.type}) — ${p.label}`);
      }
    }
    if (node.outputs.length > 0) {
      lines.push("- **Outputs:**");
      for (const p of node.outputs) {
        lines.push(`  - \`${p.id}\` (${p.type}) — ${p.label}`);
      }
    }

    const configEntries = Object.entries(node.config).filter(
      ([, v]) => v !== undefined && v !== "",
    );
    if (configEntries.length > 0) {
      lines.push("- **Config:**");
      configEntries.forEach(([k, v]) => {
        const display = typeof v === "object" ? JSON.stringify(v) : String(v);
        lines.push(`  - \`${k}\`: ${display.slice(0, 80)}`);
      });
    }
    lines.push("");
  });

  return lines.join("\n");
}
