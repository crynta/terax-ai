import { describe, expect, it } from "vitest";
import {
  artifactExportFilename,
  artifactExportFilters,
} from "@/modules/artifacts/lib/export";
import type { ArtifactSummary } from "@/modules/artifacts/lib/types";

const summary: ArtifactSummary = {
  conversationId: "pi-1",
  slug: "widget",
  title: "Widget",
  kind: "react",
  version: 1,
  contentHash: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contentBytes: 42,
};

describe("artifact export helpers", () => {
  it("exports React artifacts as compiled HTML files", () => {
    expect(artifactExportFilename({ summary, content: "source" })).toBe(
      "widget.html",
    );
    expect(artifactExportFilters("react")[0]).toEqual({
      name: "Compiled React HTML",
      extensions: ["html", "htm"],
    });
  });
});
