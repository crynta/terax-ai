import { describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/modules/artifacts/lib/types";
import {
  MODEL_COMPARE_ARTIFACT_CONVERSATION_ID,
  saveModelCompareArtifact,
} from "./artifacts";
import { createModelCompareRun } from "./modelCompare";

function artifact(slug: string, content: string): Artifact {
  return {
    summary: {
      conversationId: MODEL_COMPARE_ARTIFACT_CONVERSATION_ID,
      slug,
      title: "Model Compare",
      kind: "markdown",
      version: 1,
      contentHash: "a".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      contentBytes: content.length,
    },
    content,
  };
}

describe("saveModelCompareArtifact", () => {
  it("creates a markdown artifact in the model compare conversation", async () => {
    const run = createModelCompareRun({
      id: "cmp_1",
      prompt: "Say hi",
      blind: true,
      now: 1,
      candidates: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
    const create = vi.fn(async (_conversationId, input) =>
      artifact(input.slug, input.content),
    );
    const update = vi.fn();

    await saveModelCompareArtifact(run, { create, update });

    expect(create).toHaveBeenCalledWith(
      MODEL_COMPARE_ARTIFACT_CONVERSATION_ID,
      expect.objectContaining({
        slug: "cmp_1",
        kind: "markdown",
        content: expect.stringContaining("# Model Compare"),
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing run artifact when save is clicked again", async () => {
    const run = createModelCompareRun({
      id: "cmp_1",
      prompt: "Say hi",
      blind: true,
      now: 1,
      candidates: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    });
    const create = vi.fn(async () => {
      throw {
        code: "ARTIFACT_CONFLICT",
        message: "artifact slug already exists",
      };
    });
    const update = vi.fn(async (_conversationId, slug, content) =>
      artifact(slug, content),
    );

    await saveModelCompareArtifact(run, { create, update });

    expect(update).toHaveBeenCalledWith(
      MODEL_COMPARE_ARTIFACT_CONVERSATION_ID,
      "cmp_1",
      expect.stringContaining("# Model Compare"),
      null,
    );
  });
});
