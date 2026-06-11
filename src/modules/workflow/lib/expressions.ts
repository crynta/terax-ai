import type { WorkflowDocument } from "./schema";

/**
 * Resolve expression placeholders in a string value.
 * Supported patterns:
 *   {{variables.myVar}}   — document variable value
 *   {{node.nodeId}}       — first text artifact from a completed node
 *   {{node.nodeId.text}}  — text artifact from a specific port
 *
 * Unknown references are left as-is.
 */
export function resolveWorkflowExpressions(
  value: string,
  document: WorkflowDocument,
): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    const trimmed = expr.trim();
    const resolved = resolveExpression(trimmed, document);
    return resolved ?? match;
  });
}

function resolveExpression(
  expr: string,
  document: WorkflowDocument,
): string | null {
  // {{variables.name}}
  if (expr.startsWith("variables.")) {
    const name = expr.slice("variables.".length);
    const variable = document.variables.find((v) => v.name === name);
    if (!variable) return null;
    return typeof variable.value === "string"
      ? variable.value
      : JSON.stringify(variable.value);
  }

  // {{node.nodeId}} or {{node.nodeId.portId}}
  if (expr.startsWith("node.")) {
    const parts = expr.slice("node.".length).split(".");
    const nodeId = parts[0];
    const portId = parts[1];

    const node = document.nodes.find((n) => n.id === nodeId);
    if (node?.runtimeState.status !== "completed") return null;

    const artifactIds = new Set(node.runtimeState.artifactIds ?? []);
    const artifacts = document.artifacts.filter((a) => artifactIds.has(a.id));

    if (portId) {
      const artifact = artifacts.find((a) => a.portId === portId);
      if (!artifact) return null;
      return artifactText(artifact);
    }

    // No port specified — return first text artifact
    const textArtifact = artifacts.find((a) => a.type === "text");
    if (textArtifact) return artifactText(textArtifact);

    // Fall back to any artifact preview
    const anyArtifact = artifacts[0];
    return anyArtifact ? String(anyArtifact.preview ?? "") : null;
  }

  return null;
}

function artifactText(artifact: { value?: unknown; preview?: string }): string {
  if (typeof artifact.value === "string") return artifact.value;
  if (artifact.value !== undefined && artifact.value !== null) {
    try {
      return JSON.stringify(artifact.value);
    } catch {
      return String(artifact.value);
    }
  }
  return artifact.preview ?? "";
}

/**
 * Resolve expressions in a config object's string values.
 * Non-string values are left unchanged.
 */
export function resolveWorkflowConfigExpressions(
  config: Record<string, unknown>,
  document: WorkflowDocument,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    resolved[key] =
      typeof value === "string"
        ? resolveWorkflowExpressions(value, document)
        : value;
  }
  return resolved;
}

/**
 * Extract all expression references from a string.
 * Returns array of unique expression paths.
 */
export function extractExpressionReferences(value: string): string[] {
  const refs = new Set<string>();
  value.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    refs.add(expr.trim());
    return "";
  });
  return Array.from(refs);
}
