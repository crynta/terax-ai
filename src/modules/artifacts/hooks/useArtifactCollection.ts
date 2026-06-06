import { useCallback, useEffect, useState } from "react";
import {
  createArtifactCollectionStore,
  type ArtifactCollectionSnapshot,
} from "@/modules/artifacts/lib/collection";
import {
  onArtifactDelete,
  onArtifactUpdate,
} from "@/modules/artifacts/lib/events";
import { artifactsNative } from "@/modules/artifacts/lib/native";

const EMPTY_SNAPSHOT: ArtifactCollectionSnapshot = {
  artifacts: [],
  error: null,
  loading: false,
};

const artifactCollectionStore = createArtifactCollectionStore({
  list: artifactsNative.list,
  onDelete: onArtifactDelete,
  onUpdate: onArtifactUpdate,
});

export function useArtifactCollection(conversationId: string | null) {
  const [snapshot, setSnapshot] =
    useState<ArtifactCollectionSnapshot>(EMPTY_SNAPSHOT);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    await artifactCollectionStore.refresh(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return undefined;
    }
    return artifactCollectionStore.subscribe(conversationId, setSnapshot);
  }, [conversationId]);

  return { ...snapshot, refresh };
}
