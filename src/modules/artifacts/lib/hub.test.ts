import { describe, expect, it } from "vitest";
import type { ArtifactSummary } from "@/modules/artifacts/lib/types";
import { artifactHubRows, filterArtifactHubRows } from "./hub";

function artifact(overrides: Partial<ArtifactSummary>): ArtifactSummary {
  return {
    conversationId: "pi-1",
    slug: "hero",
    title: "Hero",
    kind: "html",
    version: 1,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    contentBytes: 12,
    ...overrides,
  };
}

describe("artifact hub model", () => {
  it("flattens session artifacts and sorts newest first", () => {
    const rows = artifactHubRows([
      {
        conversationId: "pi-1",
        sessionTitle: "First",
        updatedAt: "2026-01-01T00:00:00.000Z",
        artifacts: [
          artifact({
            slug: "old",
            title: "Old",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }),
        ],
      },
      {
        conversationId: "pi-2",
        sessionTitle: "Second",
        updatedAt: "2026-01-02T00:00:00.000Z",
        artifacts: [
          artifact({
            conversationId: "pi-2",
            slug: "new",
            title: "New",
            kind: "markdown",
            updatedAt: "2026-01-02T00:00:00.000Z",
          }),
        ],
      },
    ]);

    expect(rows.map((row) => row.artifact.slug)).toEqual(["new", "old"]);
    expect(rows[0]).toMatchObject({
      sessionId: "pi-2",
      sessionTitle: "Second",
    });
  });

  it("filters by query and artifact kind", () => {
    const rows = artifactHubRows([
      {
        conversationId: "pi-1",
        sessionTitle: "Marketing",
        updatedAt: "2026-01-01T00:00:00.000Z",
        artifacts: [
          artifact({ slug: "hero", title: "Hero", kind: "html" }),
          artifact({ slug: "notes", title: "Launch Notes", kind: "markdown" }),
        ],
      },
    ]);

    expect(
      filterArtifactHubRows(rows, "launch", "all").map(
        (row) => row.artifact.slug,
      ),
    ).toEqual(["notes"]);
    expect(
      filterArtifactHubRows(rows, "marketing", "html").map(
        (row) => row.artifact.slug,
      ),
    ).toEqual(["hero"]);
    expect(filterArtifactHubRows(rows, "hero", "markdown")).toEqual([]);
  });
});
