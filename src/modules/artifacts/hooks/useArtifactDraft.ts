import { useCallback, useEffect, useState } from "react";
import {
  type ArtifactDraftState,
  createArtifactDraft,
  mergeArtifactDraftUpdate,
  updateArtifactDraftContent,
} from "@/modules/artifacts/lib/draft";
import type { Artifact } from "@/modules/artifacts/lib/types";

export function useArtifactDraft(artifact: Artifact | null) {
  const [draft, setDraft] = useState<ArtifactDraftState | null>(() =>
    artifact ? createArtifactDraft(artifact) : null,
  );

  useEffect(() => {
    setDraft((current) => {
      if (!artifact) return null;
      return mergeArtifactDraftUpdate(current, artifact);
    });
  }, [artifact]);

  const setContent = useCallback((content: string) => {
    setDraft((current) =>
      current ? updateArtifactDraftContent(current, content) : current,
    );
  }, []);

  const reset = useCallback(() => {
    setDraft(artifact ? createArtifactDraft(artifact) : null);
  }, [artifact]);

  return { draft, setContent, reset };
}
