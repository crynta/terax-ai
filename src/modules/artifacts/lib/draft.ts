import type { Artifact } from "@/modules/artifacts/lib/types";

export type ArtifactDraftState = {
  slug: string;
  content: string;
  baseVersion: number;
  dirty: boolean;
  newerVersion: number | null;
};

export function createArtifactDraft(artifact: Artifact): ArtifactDraftState {
  return {
    slug: artifact.summary.slug,
    content: artifact.content,
    baseVersion: artifact.summary.version,
    dirty: false,
    newerVersion: null,
  };
}

export function updateArtifactDraftContent(
  draft: ArtifactDraftState,
  content: string,
): ArtifactDraftState {
  return {
    ...draft,
    content,
    dirty: content !== draft.content || draft.dirty,
  };
}

export function mergeArtifactDraftUpdate(
  draft: ArtifactDraftState | null,
  artifact: Artifact,
): ArtifactDraftState {
  if (!draft || draft.slug !== artifact.summary.slug) {
    return createArtifactDraft(artifact);
  }
  if (draft.dirty) {
    return {
      ...draft,
      newerVersion:
        artifact.summary.version > draft.baseVersion
          ? artifact.summary.version
          : draft.newerVersion,
    };
  }
  return createArtifactDraft(artifact);
}
