import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ArtifactConversationDeleteEvent,
  ArtifactDeleteEvent,
  ArtifactUpdateEvent,
} from "@/modules/artifacts/lib/types";

export const ARTIFACT_UPDATE_EVENT = "artifact:update";
export const ARTIFACT_DELETE_EVENT = "artifact:delete";
export const ARTIFACT_CONVERSATION_DELETE_EVENT =
  "artifact:conversation-delete";

export function onArtifactUpdate(
  callback: (payload: ArtifactUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<ArtifactUpdateEvent>(ARTIFACT_UPDATE_EVENT, (event) => {
    callback(event.payload);
  });
}

export function onArtifactDelete(
  callback: (payload: ArtifactDeleteEvent) => void,
): Promise<UnlistenFn> {
  return listen<ArtifactDeleteEvent>(ARTIFACT_DELETE_EVENT, (event) => {
    callback(event.payload);
  });
}

export function onArtifactConversationDelete(
  callback: (payload: ArtifactConversationDeleteEvent) => void,
): Promise<UnlistenFn> {
  return listen<ArtifactConversationDeleteEvent>(
    ARTIFACT_CONVERSATION_DELETE_EVENT,
    (event) => {
      callback(event.payload);
    },
  );
}
