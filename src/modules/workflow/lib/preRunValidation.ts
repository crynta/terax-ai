import type { WorkflowDocument, WorkflowNode } from "../lib/schema";
import {
  validateWorkflowDocument,
  validateSubgraphDepth,
  workflowConnectionWarnings,
} from "../lib/schema";
import { isUnsafeWorkflowNode } from "../lib/workflowSafety";

export type PreRunIssue = {
  severity: "error" | "warning" | "info";
  message: string;
  nodeId?: string;
};

/**
 * Run pre-flight checks on a workflow document before execution.
 */
export function preRunValidation(document: WorkflowDocument): PreRunIssue[] {
  const issues: PreRunIssue[] = [];

  // Schema validation
  for (const error of validateWorkflowDocument(document)) {
    issues.push({ severity: "error", message: error });
  }

  // Connection type warnings
  for (const warning of workflowConnectionWarnings(document)) {
    issues.push({ severity: "warning", message: warning });
  }

  // Check for nodes with missing required config
  for (const node of document.nodes) {
    const configIssues = nodeConfigIssues(node);
    issues.push(...configIssues);
  }

  // Check for disconnected nodes (nodes with no edges)
  const connectedIds = new Set<string>();
  for (const edge of document.edges) {
    connectedIds.add(edge.sourceNodeId);
    connectedIds.add(edge.targetNodeId);
  }
  for (const node of document.nodes) {
    // Skip nodes that naturally have no connections
    if (
      node.inputs.length === 0 &&
      node.outputs.length === 0 &&
      node.type !== "output"
    ) {
      continue;
    }
    if (
      !connectedIds.has(node.id) &&
      node.inputs.length > 0 &&
      document.nodes.length > 1
    ) {
      issues.push({
        severity: "info",
        message: `${node.title} has no connections`,
        nodeId: node.id,
      });
    }
  }

  // Unsafe nodes warning
  const unsafeNodes = document.nodes.filter(isUnsafeWorkflowNode);
  if (unsafeNodes.length > 0) {
    issues.push({
      severity: "info",
      message: `${unsafeNodes.length} node${unsafeNodes.length > 1 ? "s" : ""} require approval (unsafe)`,
    });
  }

  // Subgraph depth validation
  for (const node of document.nodes) {
    if (node.type === "subgraph") {
      const depthErrors = validateSubgraphDepth(document, node.id);
      for (const err of depthErrors) {
        issues.push({ severity: "error", message: err, nodeId: node.id });
      }
    }
  }

  return issues;
}

function nodeConfigIssues(node: WorkflowNode): PreRunIssue[] {
  const issues: PreRunIssue[] = [];
  const c = node.config;

  switch (node.type) {
    case "httpRequest":
      if (!c.url) {
        issues.push({
          severity: "warning",
          message: `${node.title}: URL not configured`,
          nodeId: node.id,
        });
      }
      break;
    case "shellCommand":
      if (!c.command) {
        issues.push({
          severity: "warning",
          message: `${node.title}: Command not configured`,
          nodeId: node.id,
        });
      }
      break;
    case "browserAutomation":
      if (!c.url && !c.prompt) {
        issues.push({
          severity: "warning",
          message: `${node.title}: URL and prompt not configured`,
          nodeId: node.id,
        });
      }
      break;
    case "if":
      if (!c.operator) {
        issues.push({
          severity: "warning",
          message: `${node.title}: Condition operator not set`,
          nodeId: node.id,
        });
      }
      break;
    case "switch":
      if (!c.cases) {
        issues.push({
          severity: "warning",
          message: `${node.title}: Switch cases not configured`,
          nodeId: node.id,
        });
      }
      break;
    case "setVariable":
    case "getVariable":
      if (!c.variableName) {
        issues.push({
          severity: "warning",
          message: `${node.title}: Variable name not set`,
          nodeId: node.id,
        });
      }
      break;
  }

  return issues;
}
