import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactWorkspacePanelView } from "@/modules/artifacts/ArtifactWorkspacePanel";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

const summary: ArtifactSummary = {
  conversationId: "pi-1",
  slug: "qa-react",
  title: "QA React",
  kind: "react",
  version: 1,
  contentHash: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contentBytes: 127,
};

const artifact: Artifact = {
  summary,
  content:
    'export default function App() { return <h1 className="hero">QA React</h1>; }',
};

const versions: ArtifactVersionSummary[] = [
  {
    version: 1,
    contentHash: "a".repeat(64),
    contentBytes: 127,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("ArtifactWorkspacePanel", () => {
  it("renders artifacts as a main workspace surface", () => {
    const html = renderToStaticMarkup(
      <ArtifactWorkspacePanelView
        artifacts={[summary]}
        selectedArtifact={artifact}
        selectedVersion={1}
        versions={versions}
      />,
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("QA React");
    expect(html).toContain("Preview");
    expect(html).toContain("Code");
    expect(html).toContain("h-full");
    expect(html).not.toContain("calc(100%-760px)");
  });
});
