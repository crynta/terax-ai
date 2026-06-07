import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createStarterWorkflowDocument,
  type WorkflowArtifact,
} from "../lib/schema";
import { WorkflowCanvas } from "./WorkflowCanvas";

describe("WorkflowCanvas UI smoke", () => {
  it("renders palette and runtime controls for the canvas", () => {
    const html = renderToStaticMarkup(
      <WorkflowCanvas
        document={createStarterWorkflowDocument({
          id: "wf_ui",
          title: "UI smoke",
        })}
        visible={true}
      />,
    );

    expect(html).toContain("Canvas ready");
    expect(html).toContain("Command");
    expect(html).toContain("HTTP");
    expect(html).toContain("Browser");
    expect(html).toContain("Run safe");
    expect(html).toContain("Inspector");
  });

  it("renders artifact gallery controls for stored previews", () => {
    const artifact: WorkflowArtifact = {
      id: "wf_ui:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Generated image",
      preview: "/repo/.terax-workflow-artifacts/wf_ui/image.png",
      storage: {
        kind: "file",
        path: "/repo/.terax-workflow-artifacts/wf_ui/image.png",
        mediaType: "image/png",
        byteLength: 1536,
        thumbnailPath: "/repo/.terax-workflow-artifacts/wf_ui/image.png",
      },
    };
    const html = renderToStaticMarkup(
      <WorkflowCanvas
        document={{
          ...createStarterWorkflowDocument({ id: "wf_ui", title: "UI smoke" }),
          artifacts: [artifact],
        }}
        visible={true}
      />,
    );

    expect(html).toContain("Open");
    expect(html).toContain("Reveal");
    expect(html).toContain("Copy path");
    expect(html).toContain("image/png");
  });
});
