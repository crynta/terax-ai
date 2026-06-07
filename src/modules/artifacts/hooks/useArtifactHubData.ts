import { useEffect, useMemo, useState } from "react";
import type { PiAgentSessionState } from "@/modules/agents/lib/types";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import {
  onArtifactConversationDelete,
  onArtifactDelete,
  onArtifactUpdate,
} from "@/modules/artifacts/lib/events";
import type { ArtifactHubSession } from "@/modules/artifacts/lib/hub";
import { artifactsNative } from "@/modules/artifacts/lib/native";
import type {
  Artifact,
  ArtifactConversationArtifacts,
  DeletedArtifactSummary,
} from "@/modules/artifacts/lib/types";
import { MODEL_COMPARE_ARTIFACT_CONVERSATION_ID } from "@/modules/model-compare/lib/artifacts";

export type ArtifactHubTarget = {
  conversationId: string;
  slug: string;
};

export type ArtifactHubData = {
  deletedArtifacts: DeletedArtifactSummary[];
  deletedError: string | null;
  deletedLoading: boolean;
  error: string | null;
  loading: boolean;
  previewArtifact: Artifact | null;
  previewError: string | null;
  previewLoading: boolean;
  previewTarget: ArtifactHubTarget | null;
  reload: () => void;
  sessions: ArtifactHubSession[];
  setPreviewTarget: (target: ArtifactHubTarget | null) => void;
};

export function useArtifactHubData(): ArtifactHubData {
  const piSessions = useAgentStore((state) => state.piSessions);
  const [conversations, setConversations] = useState<
    ArtifactConversationArtifacts[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [previewTarget, setPreviewTarget] = useState<ArtifactHubTarget | null>(
    null,
  );
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deletedArtifacts, setDeletedArtifacts] = useState<
    DeletedArtifactSummary[]
  >([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    artifactsNative
      .listAll()
      .then((nextConversations) => {
        if (!cancelled) setConversations(nextConversations);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setConversations([]);
          setError(artifactHubErrorMessage(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setDeletedLoading(true);
    setDeletedError(null);
    artifactsNative
      .listDeleted()
      .then((nextDeletedArtifacts) => {
        if (!cancelled) setDeletedArtifacts(nextDeletedArtifacts);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setDeletedArtifacts([]);
          setDeletedError(artifactHubErrorMessage(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setDeletedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!previewTarget) {
      setPreviewArtifact(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    artifactsNative
      .get(previewTarget.conversationId, previewTarget.slug)
      .then((artifact) => {
        if (!cancelled) setPreviewArtifact(artifact);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setPreviewArtifact(null);
          setPreviewError(artifactHubErrorMessage(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewTarget]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      if (mounted) setReloadToken((token) => token + 1);
    };
    const unlisteners: Array<() => void> = [];
    void onArtifactUpdate(refresh).then((unlisten) => {
      if (mounted) unlisteners.push(unlisten);
      else unlisten();
    });
    void onArtifactDelete(refresh).then((unlisten) => {
      if (mounted) unlisteners.push(unlisten);
      else unlisten();
    });
    void onArtifactConversationDelete(refresh).then((unlisten) => {
      if (mounted) unlisteners.push(unlisten);
      else unlisten();
    });
    return () => {
      mounted = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  const sessions = useMemo(
    () =>
      conversations.map((conversation) => ({
        artifacts: conversation.artifacts,
        conversationId: conversation.conversationId,
        sessionTitle: artifactHubConversationTitle(
          conversation.conversationId,
          piSessions,
        ),
        updatedAt: conversation.updatedAt,
      })),
    [conversations, piSessions],
  );

  return {
    deletedArtifacts,
    deletedError,
    deletedLoading,
    error,
    loading,
    previewArtifact,
    previewError,
    previewLoading,
    previewTarget,
    reload: () => setReloadToken((token) => token + 1),
    sessions,
    setPreviewTarget,
  };
}

export function artifactHubErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactHubConversationTitle(
  conversationId: string,
  piSessions: Record<string, PiAgentSessionState>,
): string {
  const sessionTitle = piSessions[conversationId]?.title?.trim();
  if (sessionTitle) return sessionTitle;
  if (conversationId === MODEL_COMPARE_ARTIFACT_CONVERSATION_ID) {
    return "Model Compare";
  }
  return conversationId;
}
