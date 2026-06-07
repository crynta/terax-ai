import type {
  Artifact,
  ArtifactCreateInput,
} from "@/modules/artifacts/lib/types";
import {
  buildCompareArtifactMarkdown,
  type ModelCompareRun,
  revealModelCompareRun,
} from "./modelCompare";

export const MODEL_COMPARE_ARTIFACT_CONVERSATION_ID = "model-compare";

export type SaveModelCompareArtifactDeps = {
  create: (
    conversationId: string,
    input: ArtifactCreateInput,
  ) => Promise<Artifact>;
  update: (
    conversationId: string,
    slug: string,
    content: string,
    baseVersion?: number | null,
  ) => Promise<Artifact>;
};

function nativeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function saveModelCompareArtifact(
  run: ModelCompareRun,
  deps: SaveModelCompareArtifactDeps,
): Promise<Artifact> {
  const content = buildCompareArtifactMarkdown(
    run.revealed ? run : revealModelCompareRun(run),
  );
  const title = `Model Compare · ${new Date(run.createdAt).toLocaleString()}`;
  try {
    return await deps.create(MODEL_COMPARE_ARTIFACT_CONVERSATION_ID, {
      slug: run.id,
      title,
      kind: "markdown",
      content,
    });
  } catch (error) {
    if (nativeErrorCode(error) !== "ARTIFACT_CONFLICT") throw error;
    return deps.update(
      MODEL_COMPARE_ARTIFACT_CONVERSATION_ID,
      run.id,
      content,
      null,
    );
  }
}
