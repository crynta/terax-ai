import { describe, expect, it } from "vitest";
import { executeWorkflowStep } from "@/modules/workflow/lib/execution";
import {
  createStarterWorkflowDocument,
  parseWorkflowDocumentJson,
  serializeWorkflowDocument,
} from "@/modules/workflow/lib/schema";
import { labelFor } from "./tabLabel";
import {
  createWorkflowTab,
  createWorkflowTabFromDocument,
  replaceWorkflowTabDocument,
  terminalLeafIdsForTab,
  upsertWorkflowDocumentTab,
} from "./useTabs";
import {
  parseWorkflowTabsRestoreSnapshot,
  workflowTabsRestoreSnapshot,
} from "./workflowTabRestore";

describe("workflow tabs", () => {
  it("uses Canvas as the default new tab title", () => {
    const tab = createWorkflowTab(12);

    expect(tab.title).toBe("Canvas");
    expect(tab.document.title).toBe("Canvas");
  });

  it("creates a workflow tab with a starter document", () => {
    const tab = createWorkflowTab(12, "Workflow");

    expect(tab).toMatchObject({
      id: 12,
      kind: "workflow",
      title: "Workflow",
      document: {
        id: "workflow-12",
        title: "Workflow",
        version: 1,
      },
    });
    expect(tab.document.nodes.map((node) => node.type)).toContain("terminal");
  });

  it("opens a workflow tab from an imported document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_imported",
      title: "Imported workflow",
    });
    const tab = createWorkflowTabFromDocument(
      22,
      document,
      "/repo/Imported.workflow.json",
    );

    expect(tab).toMatchObject({
      id: 22,
      kind: "workflow",
      title: "Imported workflow",
      path: "/repo/Imported.workflow.json",
      dirty: false,
      document,
    });
  });

  it("opens parsed workflow JSON with runtime state reset", () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const parsed = parseWorkflowDocumentJson(
      serializeWorkflowDocument(executed),
    );
    if (!parsed.ok) throw new Error(parsed.errors.join(", "));
    const tab = createWorkflowTabFromDocument(23, parsed.document);

    expect(tab.document.artifacts).toEqual([]);
    expect(tab.document.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
  });

  it("exposes workflow terminal sessions for disposal", () => {
    expect(terminalLeafIdsForTab(createWorkflowTab(14, "Workflow"))).toEqual([
      expect.any(Number),
    ]);
  });

  it("replaces a workflow document and mirrors its title", () => {
    const tab = createWorkflowTab(14, "Workflow");
    const document = {
      ...tab.document,
      title: "Edited workflow",
      nodes: tab.document.nodes.map((node) =>
        node.id === "node_prompt"
          ? { ...node, position: { x: 200, y: 260 } }
          : node,
      ),
    };

    expect(replaceWorkflowTabDocument([tab], tab.id, document)).toEqual([
      { ...tab, title: "Edited workflow", document, dirty: true },
    ]);
  });

  it("dedupes workflow tabs by persisted path", () => {
    const original = createWorkflowTabFromDocument(
      20,
      createStarterWorkflowDocument({ id: "wf_original", title: "Original" }),
      "/repo/workflow.json",
    );
    const document = createStarterWorkflowDocument({
      id: "wf_reloaded",
      title: "Reloaded",
    });
    const result = upsertWorkflowDocumentTab(
      [original],
      21,
      document,
      "/repo/workflow.json",
    );

    expect(result.activeId).toBe(20);
    expect(result.tabs).toEqual([
      { ...original, title: "Reloaded", document, dirty: false },
    ]);
  });

  it("can attach a file path when saving a workflow as a new file", () => {
    const tab = createWorkflowTab(16, "Untitled workflow");
    const document = { ...tab.document, title: "Saved workflow" };

    expect(
      replaceWorkflowTabDocument([tab], tab.id, document, {
        dirty: false,
        path: "/repo/Saved.workflow.json",
      }),
    ).toEqual([
      {
        ...tab,
        title: "Saved workflow",
        document,
        dirty: false,
        path: "/repo/Saved.workflow.json",
      },
    ]);
  });

  it("can replace a workflow document without marking it dirty after save/load", () => {
    const tab = createWorkflowTabFromDocument(
      15,
      createStarterWorkflowDocument({ id: "wf_saved", title: "Saved" }),
      "/repo/Saved.workflow.json",
    );
    const document = { ...tab.document, title: "Saved again" };

    expect(
      replaceWorkflowTabDocument([tab], tab.id, document, { dirty: false }),
    ).toEqual([{ ...tab, title: "Saved again", document, dirty: false }]);
  });

  it("serializes workflow tabs for runtime-safe session restore", () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_restore", title: "Restore" }),
    );
    const workflowTab = createWorkflowTabFromDocument(
      31,
      executed,
      "/repo/Restore.workflow.json",
    );
    const snapshot = workflowTabsRestoreSnapshot(
      [{ ...workflowTab, dirty: true }, createWorkflowTab(32, "Scratch")],
      31,
    );

    expect(snapshot.activeIndex).toBe(0);
    expect(snapshot.tabs).toHaveLength(2);
    expect(snapshot.tabs[0]).toMatchObject({
      dirty: true,
      path: "/repo/Restore.workflow.json",
    });
    expect(snapshot.tabs[0]?.documentJson).not.toContain("artifactIds");
    expect(snapshot.tabs[0]?.documentJson).not.toContain(
      "wf_restore:node_prompt:text",
    );
  });

  it("parses workflow tab restore snapshots with runtime reset", () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_restore", title: "Restore" }),
    );
    const raw = JSON.stringify({
      activeIndex: 0,
      tabs: [
        {
          dirty: true,
          documentJson: serializeWorkflowDocument(executed),
          path: "/repo/Restore.workflow.json",
        },
        { dirty: true, documentJson: "not json" },
      ],
      version: 1,
    });

    const restored = parseWorkflowTabsRestoreSnapshot(raw);

    expect(restored.activeIndex).toBe(0);
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]?.dirty).toBe(true);
    expect(restored.tabs[0]?.path).toBe("/repo/Restore.workflow.json");
    expect(restored.tabs[0]?.document.artifacts).toEqual([]);
    expect(
      restored.tabs[0]?.document.nodes.map((node) => node.runtimeState),
    ).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
  });

  it("uses the workflow title as its tab label", () => {
    expect(labelFor(createWorkflowTab(13, "Media automation"))).toBe(
      "Media automation",
    );
  });
});
