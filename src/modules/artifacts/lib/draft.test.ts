import { describe, expect, it } from "vitest";
import {
  createArtifactDraft,
  mergeArtifactDraftUpdate,
  updateArtifactDraftContent,
} from "@/modules/artifacts/lib/draft";
import type { Artifact } from "@/modules/artifacts/lib/types";

function artifact(version: number, content: string): Artifact {
  return {
    summary: {
      conversationId: "pi-1",
      slug: "doc",
      title: "Doc",
      kind: "markdown",
      version,
      contentHash: "a".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: `2026-01-01T00:00:0${version}.000Z`,
      contentBytes: content.length,
    },
    content,
  };
}

describe("artifact draft state", () => {
  it("tracks base version and dirty content", () => {
    const draft = createArtifactDraft(artifact(1, "original"));
    const edited = updateArtifactDraftContent(draft, "edited");

    expect(draft).toMatchObject({
      content: "original",
      baseVersion: 1,
      dirty: false,
    });
    expect(edited).toMatchObject({
      content: "edited",
      baseVersion: 1,
      dirty: true,
    });
  });

  it("preserves dirty drafts when newer artifact content arrives", () => {
    const dirty = updateArtifactDraftContent(
      createArtifactDraft(artifact(1, "original")),
      "mine",
    );
    const merged = mergeArtifactDraftUpdate(dirty, artifact(2, "remote"));

    expect(merged.content).toBe("mine");
    expect(merged.baseVersion).toBe(1);
    expect(merged.newerVersion).toBe(2);
  });
});
