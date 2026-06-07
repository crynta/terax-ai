import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  auditEntryKey,
  buildCapabilityAuditView,
  PiCapabilityAuditCard,
} from "@/modules/pi/components/PiCapabilityAuditCard";
import type { CapabilityAuditEntry } from "@/modules/pi/lib/status";

const entries: CapabilityAuditEntry[] = [
  {
    sequence: 1,
    sessionId: "pi-a",
    toolCallId: "call-read",
    toolName: "read",
    approved: false,
    allowed: true,
    outcome: "succeeded",
  },
  {
    sequence: 2,
    sessionId: "pi-b",
    toolCallId: "call-mcp",
    toolName: "mcp__filesystem__read_file",
    approved: false,
    allowed: false,
    outcome: "blocked",
    message: "capability tool requires approval",
  },
  {
    sequence: 3,
    sessionId: "pi-b",
    toolCallId: "call-shell",
    toolName: "bash",
    approved: true,
    allowed: true,
    outcome: "failed",
    message: "exit 1",
  },
  {
    sequence: 4,
    sessionId: "workflow-a",
    toolCallId: "node-http",
    toolName: "workflow.http_request",
    approved: true,
    allowed: true,
    outcome: "succeeded",
  },
  {
    sequence: 5,
    sessionId: "app",
    toolCallId: "app-1",
    toolName: "app.file_write",
    approved: false,
    allowed: true,
    outcome: "succeeded",
  },
];

describe("PiCapabilityAuditCard", () => {
  it("builds filtered audit views with newest entries first", () => {
    const all = buildCapabilityAuditView(entries, "all");
    expect(all.totalCount).toBe(5);
    expect(all.mcpCount).toBe(1);
    expect(all.workflowCount).toBe(1);
    expect(all.appCount).toBe(1);
    expect(all.coreCount).toBe(2);
    expect(all.blockedCount).toBe(1);
    expect(all.failedCount).toBe(1);
    expect(all.entries.map((entry) => entry.sequence)).toEqual([5, 4, 3, 2, 1]);
    expect(all.exportText).toContain("mcp__filesystem__read_file");

    const mcp = buildCapabilityAuditView(entries, "mcp");
    expect(mcp.entries).toHaveLength(1);
    expect(mcp.entries[0]?.toolName).toBe("mcp__filesystem__read_file");

    const workflow = buildCapabilityAuditView(entries, "workflow");
    expect(workflow.entries.map((entry) => entry.toolName)).toEqual([
      "workflow.http_request",
    ]);

    const app = buildCapabilityAuditView(entries, "app");
    expect(app.entries.map((entry) => entry.toolName)).toEqual([
      "app.file_write",
    ]);

    const core = buildCapabilityAuditView(entries, "core");
    expect(core.entries.map((entry) => entry.toolName)).toEqual([
      "bash",
      "read",
    ]);
  });

  it("renders summary counts, filters, and complete audit rows", () => {
    const html = renderToStaticMarkup(
      <PiCapabilityAuditCard
        collapsed={false}
        disabled={false}
        entries={entries}
        expandedEntryKeys={[auditEntryKey(entries[1])]}
        onCollapsedChange={vi.fn()}
      />,
    );

    expect(html).toContain("Capability audit");
    expect(html).toContain("5 events");
    expect(html).toContain("MCP 1");
    expect(html).toContain("Flow 1");
    expect(html).toContain("App 1");
    expect(html).toContain("Core 2");
    expect(html).toContain("Blocked 1");
    expect(html).toContain("Failed 1");
    expect(html).toContain("mcp__filesystem__read_file");
    expect(html).toContain("workflow.http_request");
    expect(html).toContain("app.file_write");
    expect(html).toContain("capability tool requires approval");
    expect(html).toContain('aria-label="Copy capability audit"');
  });

  it("supports controlled filter and expanded audit rows", () => {
    const onFilterChange = vi.fn();
    const onExpandedEntryKeysChange = vi.fn();
    const expandedKey = auditEntryKey(entries[1]);

    const html = renderToStaticMarkup(
      <PiCapabilityAuditCard
        collapsed={false}
        disabled={false}
        entries={entries}
        expandedEntryKeys={[expandedKey]}
        filter="mcp"
        onCollapsedChange={vi.fn()}
        onExpandedEntryKeysChange={onExpandedEntryKeysChange}
        onFilterChange={onFilterChange}
      />,
    );

    expect(html).toContain("mcp__filesystem__read_file");
    expect(html).not.toContain("workflow.http_request");
    expect(html).toContain("session pi-b");
    expect(html).toContain("capability tool requires approval");
  });

  it("renders an empty state before audit entries exist", () => {
    const html = renderToStaticMarkup(
      <PiCapabilityAuditCard
        collapsed={false}
        disabled={false}
        entries={[]}
        onCollapsedChange={vi.fn()}
      />,
    );

    expect(html).toContain("No capability events yet");
    expect(html).toContain(
      "Tool decisions will appear here after Pi or workflows use native capabilities.",
    );
  });
});
