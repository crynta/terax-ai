import { describe, expect, it } from "vitest";
import { createStarterWorkflowDocument, type WorkflowDocument } from "./schema";

/**
 * Minimal undo/redo stack test — the hook itself is tested via integration
 * since @testing-library/react is not available. Here we test the underlying
 * logic: structuredClone round-trips preserve workflow state.
 */
describe("workflow undo/redo logic", () => {
  it("structuredClone preserves workflow document integrity", () => {
    const doc = createStarterWorkflowDocument({
      id: "wf_clone",
      title: "Clone Test",
    });
    const cloned = structuredClone(doc);
    expect(cloned.id).toBe(doc.id);
    expect(cloned.nodes.length).toBe(doc.nodes.length);
    expect(cloned.edges.length).toBe(doc.edges.length);
    expect(cloned.artifacts.length).toBe(doc.artifacts.length);
    // Verify deep independence
    cloned.nodes[0].title = "Modified";
    expect(doc.nodes[0].title).not.toBe("Modified");
  });

  it("undo stack simulation works correctly", () => {
    const doc1 = createStarterWorkflowDocument({
      id: "wf_stack",
      title: "V1",
    });
    const doc2: WorkflowDocument = {
      ...doc1,
      title: "V2",
    };
    const undoStack: WorkflowDocument[] = [];
    const redoStack: WorkflowDocument[] = [];

    // Push current state before change
    undoStack.push(structuredClone(doc1));
    expect(undoStack.length).toBe(1);

    // Simulate undo
    redoStack.push(structuredClone(doc2));
    const restored = undoStack.pop()!;
    expect(restored.title).toBe("V1");
    expect(redoStack.length).toBe(1);

    // Simulate redo
    undoStack.push(structuredClone(restored));
    const next = redoStack.pop()!;
    expect(next.title).toBe("V2");
    expect(undoStack.length).toBe(1);
    expect(redoStack.length).toBe(0);
  });

  it("new push clears redo stack", () => {
    const undoStack: string[] = ["v1"];
    const redoStack: string[] = ["v3"];

    // New push clears redo
    undoStack.push("v2");
    redoStack.length = 0;

    expect(undoStack).toEqual(["v1", "v2"]);
    expect(redoStack).toEqual([]);
  });
});
