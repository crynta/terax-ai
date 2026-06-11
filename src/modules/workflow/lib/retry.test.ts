import { describe, expect, it } from "vitest";
import {
  retrySourceNode,
  resetNodeForRetry,
  retryShouldReExecute,
  retryExhausted,
  retryErrorArtifact,
  retrySuccessArtifact,
} from "./execution/retry";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowDocument,
  type WorkflowEdge,
} from "./schema";

function docWithRetrySetup(): WorkflowDocument {
  let doc = createStarterWorkflowDocument({
    id: "wf_retry",
    title: "Retry Test",
  });
  doc = addWorkflowNode(doc, {
    id: "source",
    type: "httpRequest",
    position: { x: 100, y: 100 },
  });
  doc = addWorkflowNode(doc, {
    id: "retry",
    type: "retry",
    position: { x: 400, y: 100 },
  });
  doc = updateWorkflowNodeConfig(doc, "retry", { maxAttempts: 3, delayMs: 0 });
  const edge: WorkflowEdge = {
    id: "e1",
    sourceNodeId: "source",
    sourcePortId: "output",
    targetNodeId: "retry",
    targetPortId: "input",
  };
  return { ...doc, edges: [...doc.edges, edge] };
}

describe("retry execution", () => {
  it("finds the upstream source node", () => {
    const doc = docWithRetrySetup();
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    const source = retrySourceNode(doc, retry);
    expect(source?.id).toBe("source");
  });

  it("returns null when no upstream edge", () => {
    let doc = createStarterWorkflowDocument({ id: "wf", title: "T" });
    doc = addWorkflowNode(doc, {
      id: "r",
      type: "retry",
      position: { x: 100, y: 100 },
    });
    const retry = doc.nodes.find((n) => n.id === "r")!;
    expect(retrySourceNode(doc, retry)).toBeNull();
  });

  it("resets a node for retry with incremented attempt", () => {
    let doc = docWithRetrySetup();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "source"
          ? {
              ...n,
              runtimeState: {
                status: "failed",
                message: "timeout",
                attempt: 1,
              },
            }
          : n,
      ),
    };
    const reset = resetNodeForRetry(doc, "source");
    const source = reset.nodes.find((n) => n.id === "source")!;
    expect(source.runtimeState.status).toBe("idle");
    expect(source.runtimeState.attempt).toBe(2);
  });

  it("detects when re-execution is needed", () => {
    let doc = docWithRetrySetup();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "source"
          ? {
              ...n,
              runtimeState: {
                status: "failed",
                message: "timeout",
                attempt: 1,
              },
            }
          : n,
      ),
    };
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    expect(retryShouldReExecute(doc, retry)).toBe(true);
  });

  it("detects when retry is exhausted", () => {
    let doc = docWithRetrySetup();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "source"
          ? {
              ...n,
              runtimeState: {
                status: "failed",
                message: "timeout",
                attempt: 3,
              },
            }
          : n,
      ),
    };
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    expect(retryExhausted(doc, retry)).toBe(true);
  });

  it("does not re-execute when source is not failed", () => {
    const doc = docWithRetrySetup();
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    expect(retryShouldReExecute(doc, retry)).toBe(false);
  });

  it("produces error artifact with attempt count", () => {
    let doc = docWithRetrySetup();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "source"
          ? {
              ...n,
              runtimeState: {
                status: "failed",
                message: "Connection refused",
                attempt: 3,
              },
            }
          : n,
      ),
    };
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    const artifact = retryErrorArtifact(doc, retry);
    expect(artifact.type).toBe("text");
    expect(artifact.preview).toContain("3 attempts");
    expect(artifact.preview).toContain("Connection refused");
    expect(artifact.portId).toBe("error");
  });

  it("produces success artifact from source output", () => {
    let doc = docWithRetrySetup();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "source"
          ? { ...n, runtimeState: { status: "completed", artifactIds: ["a1"] } }
          : n,
      ),
      artifacts: [
        {
          id: "a1",
          nodeId: "source",
          type: "text",
          label: "Response",
          preview: "OK data",
          value: "OK data",
        },
      ],
    };
    const retry = doc.nodes.find((n) => n.id === "retry")!;
    const artifact = retrySuccessArtifact(doc, retry);
    expect(artifact.type).toBe("text");
    expect(artifact.preview).toContain("OK data");
    expect(artifact.portId).toBe("output");
  });
});
