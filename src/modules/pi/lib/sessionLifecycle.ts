import { piNative } from "@/modules/pi/lib/native";
import type { PiSessionDeleteWithArtifactsResult } from "@/modules/pi/lib/sessions";

export type DeletePiSessionWithArtifactCleanupInput = {
  sessionId: string;
  deleteSessionWithArtifacts?: (
    sessionId: string,
  ) => Promise<PiSessionDeleteWithArtifactsResult>;
};

export type DeletePiSessionWithArtifactCleanupResult =
  PiSessionDeleteWithArtifactsResult;

export async function deletePiSessionWithArtifactCleanup({
  deleteSessionWithArtifacts = piNative.sessionDeleteWithArtifacts,
  sessionId,
}: DeletePiSessionWithArtifactCleanupInput): Promise<DeletePiSessionWithArtifactCleanupResult> {
  return deleteSessionWithArtifacts(sessionId);
}
