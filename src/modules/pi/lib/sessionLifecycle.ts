import type { PiSessionDeleteWithArtifactsResult } from "@/modules/pi/lib/sessions";
import { getSessionBackend } from "@/modules/pi/lib/pi-session-backend";

export type DeletePiSessionWithArtifactCleanupInput = {
  sessionId: string;
  deleteSessionWithArtifacts?: (
    sessionId: string,
  ) => Promise<PiSessionDeleteWithArtifactsResult>;
};

export type DeletePiSessionWithArtifactCleanupResult =
  PiSessionDeleteWithArtifactsResult;

export async function deletePiSessionWithArtifactCleanup({
  deleteSessionWithArtifacts = (id) =>
    getSessionBackend().sessionDeleteWithArtifacts(id),
  sessionId,
}: DeletePiSessionWithArtifactCleanupInput): Promise<DeletePiSessionWithArtifactCleanupResult> {
  return deleteSessionWithArtifacts(sessionId);
}
