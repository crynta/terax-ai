import type { PiAgentSessionState } from "@/modules/agents/lib/types";
import { MODEL_COMPARE_ARTIFACT_CONVERSATION_ID } from "@/modules/model-compare/lib/artifacts";
import type { ArtifactWorkspaceTabInput, Tab } from "@/modules/tabs";

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

type ArtifactWorkspaceLauncherOptions = {
  chatSelectedSessionId: string | null;
  chatSidebarVisible: boolean;
  codePanelVisible: boolean;
  codeSelectedSessionId: string | null;
  piSessions: Record<string, PiAgentSessionState>;
  tabs: readonly Tab[];
};

export function artifactWorkspaceConversationForLauncher({
  chatSelectedSessionId,
  chatSidebarVisible,
  codePanelVisible,
  codeSelectedSessionId,
  piSessions,
  tabs,
}: ArtifactWorkspaceLauncherOptions): string | null {
  if (codePanelVisible && codeSelectedSessionId) return codeSelectedSessionId;
  if (chatSidebarVisible && chatSelectedSessionId) return chatSelectedSessionId;

  const existingArtifactTab = tabs.find((tab) => tab.kind === "artifact");
  if (existingArtifactTab?.kind === "artifact") {
    return existingArtifactTab.conversationId;
  }

  const newestSession = Object.values(piSessions).sort(
    (left, right) => right.lastActivityAt - left.lastActivityAt,
  )[0];
  return newestSession?.sessionId ?? null;
}
