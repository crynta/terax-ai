import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactPanel } from "@/modules/artifacts/components/ArtifactPanel";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

const summary: ArtifactSummary = {
  conversationId: "pi-1",
  slug: "hero",
  title: "Hero",
  kind: "html",
  version: 2,
  contentHash: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  contentBytes: 18,
};

const artifact: Artifact = {
  summary,
  content: "<h1>Hero</h1>",
};

const versions: ArtifactVersionSummary[] = [
  {
    version: 1,
    contentHash: "b".repeat(64),
    contentBytes: 14,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    version: 2,
    contentHash: "a".repeat(64),
    contentBytes: 18,
    createdAt: "2026-01-01T00:00:01.000Z",
  },
];

describe("ArtifactPanel", () => {
  it("renders a helpful empty state", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel artifacts={[]} selectedArtifact={null} />,
    );

    expect(html).toContain("No artifacts yet");
    expect(html).toContain("Ask Pi to create an artifact");
  });

  it("renders artifact metadata and preview/code controls", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel artifacts={[summary]} selectedArtifact={artifact} />,
    );

    expect(html).toContain("Hero");
    expect(html).toContain("html");
    expect(html).toContain("v2");
    expect(html).toContain("Preview");
    expect(html).toContain("Code");
  });

  it("renders an export action for selected artifacts", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel
        artifacts={[summary]}
        selectedArtifact={artifact}
        onExportArtifact={() => {}}
      />,
    );

    expect(html).toContain("Export");
  });

  it("renders version controls for the selected artifact", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel
        artifacts={[summary]}
        selectedArtifact={artifact}
        selectedVersion={1}
        versions={versions}
      />,
    );

    expect(html).toContain("Versions");
    expect(html).toContain("v1");
    expect(html).toContain("v2");
    expect(html).toContain("Viewing v1");
  });
});
