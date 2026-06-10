import type { WorkflowDocument } from "./schema";

/**
 * Export a workflow document as an SVG image string.
 * Renders nodes as styled rectangles with labels and edges as lines.
 */
export function workflowToSvg(document: WorkflowDocument): string {
  const padding = 40;
  const nodes = document.nodes;
  const edges = document.edges;

  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="100" y="50" text-anchor="middle" fill="#999" font-family="sans-serif">Empty workflow</text></svg>`;
  }

  // Compute bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }

  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];

  // Background
  parts.push(`<rect width="${width}" height="${height}" fill="#fafafa" rx="8" />`);

  // Title
  parts.push(
    `<text x="${padding}" y="${padding - 10}" font-family="sans-serif" font-size="16" font-weight="600" fill="#333">${escapeXml(document.title)}</text>`,
  );

  // Edges
  for (const edge of edges) {
    const src = nodeMap.get(edge.sourceNodeId);
    const tgt = nodeMap.get(edge.targetNodeId);
    if (!src || !tgt) continue;

    const x1 = src.position.x + src.size.width + offsetX;
    const y1 = src.position.y + src.size.height / 2 + offsetY;
    const x2 = tgt.position.x + offsetX;
    const y2 = tgt.position.y + tgt.size.height / 2 + offsetY;

    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6366f1" stroke-width="2" />`,
    );
    // Arrow
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrowSize = 8;
    const ax1 = x2 - arrowSize * Math.cos(angle - 0.4);
    const ay1 = y2 - arrowSize * Math.sin(angle - 0.4);
    const ax2 = x2 - arrowSize * Math.cos(angle + 0.4);
    const ay2 = y2 - arrowSize * Math.sin(angle + 0.4);
    parts.push(
      `<polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="#6366f1" />`,
    );
  }

  // Nodes
  for (const node of nodes) {
    const x = node.position.x + offsetX;
    const y = node.position.y + offsetY;
    const w = node.size.width;
    const h = node.size.height;

    const status = node.runtimeState.status;
    let borderColor = "#e2e8f0";
    if (status === "completed") borderColor = "#22c55e";
    else if (status === "failed") borderColor = "#ef4444";
    else if (status === "running") borderColor = "#eab308";

    // Card background
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="white" stroke="${borderColor}" stroke-width="1.5" />`,
    );

    // Type badge
    parts.push(
      `<rect x="${x + 8}" y="${y + 8}" rx="4" width="${Math.min(node.type.length * 7 + 12, w - 16)}" height="18" fill="#f1f5f9" />`,
    );
    parts.push(
      `<text x="${x + 14}" y="${y + 21}" font-family="sans-serif" font-size="9" fill="#64748b">${escapeXml(node.type)}</text>`,
    );

    // Title
    const titleY = y + 44;
    parts.push(
      `<text x="${x + 8}" y="${titleY}" font-family="sans-serif" font-size="12" font-weight="500" fill="#1e293b">${escapeXml(node.title)}</text>`,
    );

    // Input ports (left)
    node.inputs.forEach((_port, i) => {
      const py = y + 14 + i * 16;
      parts.push(
        `<circle cx="${x}" cy="${py}" r="4" fill="#6366f1" />`,
      );
    });

    // Output ports (right)
    node.outputs.forEach((_port, i) => {
      const py = y + 14 + i * 16;
      parts.push(
        `<circle cx="${x + w}" cy="${py}" r="4" fill="#6366f1" />`,
      );
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${parts.join("\n")}\n</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
