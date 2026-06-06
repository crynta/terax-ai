import type { PiAgentSessionState } from "@/modules/agents/lib/types";
import { MODEL_COMPARE_ARTIFACT_CONVERSATION_ID } from "@/modules/model-compare/lib/artifacts";
import type { ArtifactWorkspaceTabInput } from "@/modules/tabs";

type ArtifactWorkspaceTabInputOptions = {
  conversationId: string;
  selectedSlug: string | null;
  piSessions: Record<string, PiAgentSessionState>;
};

export function artifactWorkspaceTabInput({
  conversationId,
  selectedSlug,
  piSessions,
}: ArtifactWorkspaceTabInputOptions): ArtifactWorkspaceTabInput {
  const sessionTitle = piSessions[conversationId]?.title?.trim();
  const title =
    sessionTitle ??
    (conversationId === MODEL_COMPARE_ARTIFACT_CONVERSATION_ID
      ? "Model Compare"
      : null);
  return {
    conversationId,
    selectedSlug,
    title: title ? `Artifacts · ${title}` : "Artifacts",
  };
}
