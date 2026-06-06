import type { ArtifactUpdateEvent } from "@/modules/artifacts/lib/types";

export type ChatArtifactSidecarState = {
  open: boolean;
  selectedSlug: string | null;
};

export function reduceChatArtifactUpdate(
  state: ChatArtifactSidecarState,
  selectedSessionId: string | null,
  event: ArtifactUpdateEvent,
): ChatArtifactSidecarState {
  if (!selectedSessionId || event.conversationId !== selectedSessionId) {
    return state;
  }
  return {
    open: true,
    selectedSlug: event.artifact.slug,
  };
}
