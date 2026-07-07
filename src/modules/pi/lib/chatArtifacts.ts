import type { ArtifactUpdateEvent } from "@/modules/artifacts/lib/types";

export type ChatArtifactPanelState = {
  open: boolean;
  selectedSlug: string | null;
};

export function reduceChatArtifactUpdate(
  state: ChatArtifactPanelState,
  selectedSessionId: string | null,
  event: ArtifactUpdateEvent,
): ChatArtifactPanelState {
  if (!selectedSessionId || event.conversationId !== selectedSessionId) {
    return state;
  }
  return {
    open: true,
    selectedSlug: event.artifact.slug,
  };
}
