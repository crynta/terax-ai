import type {
  ArtifactKind,
  ArtifactSummary,
} from "@/modules/artifacts/lib/types";

export type ArtifactHubSession = {
  artifacts: ArtifactSummary[];
  conversationId: string;
  sessionTitle: string;
  updatedAt: string | null;
};

export type ArtifactHubRow = {
  artifact: ArtifactSummary;
  sessionId: string;
  sessionTitle: string;
};

export function artifactHubRows(
  sessions: readonly ArtifactHubSession[],
): ArtifactHubRow[] {
  return sessions
    .flatMap((entry) =>
      entry.artifacts.map((artifact) => ({
        artifact,
        sessionId: entry.conversationId,
        sessionTitle: entry.sessionTitle,
      })),
    )
    .sort((left, right) => {
      const timeCompare =
        Date.parse(right.artifact.updatedAt) -
        Date.parse(left.artifact.updatedAt);
      if (Number.isFinite(timeCompare) && timeCompare !== 0) return timeCompare;
      return left.artifact.title.localeCompare(right.artifact.title);
    });
}

export function filterArtifactHubRows(
  rows: readonly ArtifactHubRow[],
  query: string,
  kind: ArtifactKind | "all" = "all",
): ArtifactHubRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (kind !== "all" && row.artifact.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return [
      row.artifact.title,
      row.artifact.slug,
      row.artifact.kind,
      row.sessionTitle,
      row.sessionId,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}
