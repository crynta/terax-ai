import { describe, expect, it } from "vitest";
import { exportWorkflowMarkdown } from "./exportMarkdown";
import { createStarterWorkflowDocument, type WorkflowDocument } from "./schema";

describe("workflow markdown export", () => {
  it("generates markdown with title and node list", () => {
    const doc = createStarterWorkflowDocument({
      id: "wf_md",
      title: "Test Workflow",
    });
    const md = exportWorkflowMarkdown(doc);
    expect(md).toContain("# Test Workflow");
    expect(md).toContain("**ID:** wf_md");
    expect(md).toContain("### Prompt");
    expect(md).toContain("### Terminal");
    expect(md).toContain("## Connections");
  });

  it("includes variables section when present", () => {
    const doc = {
      ...createStarterWorkflowDocument({ id: "wf_vars", title: "Vars" }),
      variables: [
        { id: "v1", name: "apiKey", type: "text" as const, value: "secret" },
      ],
    };
    const md = exportWorkflowMarkdown(doc);
    expect(md).toContain("**Variables:** apiKey");
  });

  it("includes run history when present", () => {
    const doc: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_hist", title: "Hist" }),
      runHistory: [
        {
          id: "run_1",
          startedAt: new Date(Date.now() - 5000).toISOString(),
          finishedAt: new Date().toISOString(),
          nodeCount: 3,
          completedCount: 3,
          failedCount: 0,
          status: "completed" as const,
          nodeSnapshots: [],
        },
      ],
    };
    const md = exportWorkflowMarkdown(doc);
    expect(md).toContain("## Run History");
    expect(md).toContain("completed");
  });
});
