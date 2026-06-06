import type {
  ArtifactDeleteEvent,
  ArtifactSummary,
  ArtifactUpdateEvent,
} from "@/modules/artifacts/lib/types";

type Unlisten = () => void;

export type ArtifactCollectionSnapshot = {
  artifacts: ArtifactSummary[];
  error: string | null;
  loading: boolean;
};

type ArtifactCollectionEntry = {
  inflight: Promise<void> | null;
  listeners: Set<(snapshot: ArtifactCollectionSnapshot) => void>;
  snapshot: ArtifactCollectionSnapshot;
};

type ArtifactCollectionStoreDeps = {
  list: (conversationId: string) => Promise<ArtifactSummary[]>;
  onDelete: (
    callback: (payload: ArtifactDeleteEvent) => void,
  ) => Promise<Unlisten>;
  onUpdate: (
    callback: (payload: ArtifactUpdateEvent) => void,
  ) => Promise<Unlisten>;
};

const EMPTY_COLLECTION_SNAPSHOT: ArtifactCollectionSnapshot = {
  artifacts: [],
  error: null,
  loading: false,
};

function emptyCollectionSnapshot(): ArtifactCollectionSnapshot {
  return { ...EMPTY_COLLECTION_SNAPSHOT };
}

export function createArtifactCollectionStore({
  list,
  onDelete,
  onUpdate,
}: ArtifactCollectionStoreDeps) {
  const entries = new Map<string, ArtifactCollectionEntry>();
  let subscriptionCount = 0;
  let updateListening = false;
  let deleteListening = false;
  let updateUnlisten: Unlisten | null = null;
  let deleteUnlisten: Unlisten | null = null;

  function getOrCreateEntry(conversationId: string): ArtifactCollectionEntry {
    const existing = entries.get(conversationId);
    if (existing) return existing;
    const entry: ArtifactCollectionEntry = {
      inflight: null,
      listeners: new Set(),
      snapshot: emptyCollectionSnapshot(),
    };
    entries.set(conversationId, entry);
    return entry;
  }

  function notify(entry: ArtifactCollectionEntry): void {
    for (const listener of entry.listeners) {
      listener(entry.snapshot);
    }
  }

  function updateSnapshot(
    entry: ArtifactCollectionEntry,
    snapshot: ArtifactCollectionSnapshot,
  ): void {
    entry.snapshot = snapshot;
    notify(entry);
  }

  function stopGlobalListenersIfIdle(): void {
    if (subscriptionCount > 0) return;

    if (updateUnlisten) {
      updateUnlisten();
      updateUnlisten = null;
      updateListening = false;
    }
    if (deleteUnlisten) {
      deleteUnlisten();
      deleteUnlisten = null;
      deleteListening = false;
    }
  }

  function ensureGlobalListeners(): void {
    if (!updateListening) {
      updateListening = true;
      void onUpdate((payload) => {
        const entry = entries.get(payload.artifact.conversationId);
        if (!entry) return;
        updateSnapshot(entry, {
          ...entry.snapshot,
          artifacts: applyArtifactUpdate(
            entry.snapshot.artifacts,
            payload.artifact.conversationId,
            payload.artifact,
          ),
          error: null,
        });
      })
        .then((unlisten) => {
          updateUnlisten = unlisten;
          stopGlobalListenersIfIdle();
        })
        .catch(() => {
          updateListening = false;
        });
    }

    if (!deleteListening) {
      deleteListening = true;
      void onDelete((payload) => {
        const entry = entries.get(payload.conversationId);
        if (!entry) return;
        updateSnapshot(entry, {
          ...entry.snapshot,
          artifacts: applyArtifactDelete(
            entry.snapshot.artifacts,
            payload.conversationId,
            payload,
          ),
          error: null,
        });
      })
        .then((unlisten) => {
          deleteUnlisten = unlisten;
          stopGlobalListenersIfIdle();
        })
        .catch(() => {
          deleteListening = false;
        });
    }
  }

  async function load(conversationId: string): Promise<void> {
    const entry = getOrCreateEntry(conversationId);
    if (entry.inflight) return entry.inflight;

    updateSnapshot(entry, {
      ...entry.snapshot,
      loading: true,
    });

    entry.inflight = list(conversationId)
      .then((artifacts) => {
        updateSnapshot(entry, {
          artifacts,
          error: null,
          loading: false,
        });
      })
      .catch((error) => {
        updateSnapshot(entry, {
          ...entry.snapshot,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        });
      })
      .finally(() => {
        entry.inflight = null;
      });

    return entry.inflight;
  }

  return {
    getSnapshot(conversationId: string): ArtifactCollectionSnapshot {
      return getOrCreateEntry(conversationId).snapshot;
    },
    refresh(conversationId: string): Promise<void> {
      return load(conversationId);
    },
    subscribe(
      conversationId: string,
      listener: (snapshot: ArtifactCollectionSnapshot) => void,
    ): () => void {
      subscriptionCount += 1;
      ensureGlobalListeners();
      const entry = getOrCreateEntry(conversationId);
      entry.listeners.add(listener);
      listener(entry.snapshot);
      void load(conversationId);

      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) entries.delete(conversationId);
        subscriptionCount = Math.max(0, subscriptionCount - 1);
        stopGlobalListenersIfIdle();
      };
    },
  };
}

export function applyArtifactUpdate(
  artifacts: ArtifactSummary[],
  activeConversationId: string,
  artifact: ArtifactSummary,
): ArtifactSummary[] {
  if (artifact.conversationId !== activeConversationId) return artifacts;
  const index = artifacts.findIndex((item) => item.slug === artifact.slug);
  if (index === -1) return sortArtifacts([artifact, ...artifacts]);
  const next = artifacts.slice();
  next[index] = artifact;
  return sortArtifacts(next);
}

export function applyArtifactDelete(
  artifacts: ArtifactSummary[],
  activeConversationId: string,
  event: Pick<ArtifactDeleteEvent, "conversationId" | "slug">,
): ArtifactSummary[] {
  if (event.conversationId !== activeConversationId) return artifacts;
  return artifacts.filter((artifact) => artifact.slug !== event.slug);
}

function sortArtifacts(artifacts: ArtifactSummary[]): ArtifactSummary[] {
  return artifacts
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
