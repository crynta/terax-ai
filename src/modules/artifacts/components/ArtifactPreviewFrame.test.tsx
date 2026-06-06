import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactPreviewFrame } from "@/modules/artifacts/components/ArtifactPreviewFrame";

const artifact = {
  summary: {
    conversationId: "pi-1",
    slug: "hero",
    title: "Hero",
    kind: "html" as const,
    version: 1,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    contentBytes: 12,
  },
  content: "<h1>Hero</h1>",
};

const reactArtifact = {
  ...artifact,
  summary: {
    ...artifact.summary,
    kind: "react" as const,
  },
  content:
    'export default function Card() { return <section className="hero">Hello</section>; }',
};

describe("ArtifactPreviewFrame", () => {
  it("renders an isolated iframe without same-origin privileges", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreviewFrame artifact={artifact} />,
    );

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("Preview of Hero");
  });

  it("does not render raw React source while the compiled preview loads", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreviewFrame artifact={reactArtifact} />,
    );

    expect(html).toContain("Compiling React preview");
    expect(html).not.toContain("export default function Card");
    expect(html).not.toContain("&lt;section");
  });
});
