import { useCallback, useEffect, useState } from "react";
import {
  onArtifactDelete,
  onArtifactUpdate,
} from "@/modules/artifacts/lib/events";
import type {
  ArtifactDeleteEvent,
  ArtifactUpdateEvent,
} from "@/modules/artifacts/lib/types";
import type { InboxArtifactRow } from "@/modules/inbox/lib/model";

const MAX_ARTIFACT_INBOX_ROWS = 50;

type VisibleArtifactConversations = string | null | readonly (string | null)[];

export function artifactConversationIsVisible(
  conversationId: string,
  visibleConversations: VisibleArtifactConversations,
): boolean {
  if (visibleConversations === null) return false;
  if (typeof visibleConversations === "string") {
    return visibleConversations === conversationId;
  }
  return visibleConversations.some((visible) => visible === conversationId);
}

function visibleConversationsKey(
  visibleConversations: VisibleArtifactConversations,
): string {
  if (visibleConversations === null) return "";
  if (typeof visibleConversations === "string") return visibleConversations;
  return visibleConversations.filter(Boolean).join("\u0000");
}

function artifactInboxId(conversationId: string, slug: string): string {
  return `artifact:${conversationId}:${slug}`;
}

function artifactTimestamp(event: ArtifactUpdateEvent): number {
  const parsed = Date.parse(event.artifact.updatedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function artifactRow(event: ArtifactUpdateEvent): InboxArtifactRow {
  return {
    at: artifactTimestamp(event),
    body: event.reason === "edit" ? "Artifact updated" : "Artifact created",
    conversationId: event.conversationId,
    id: artifactInboxId(event.conversationId, event.artifact.slug),
    read: false,
    slug: event.artifact.slug,
    title: event.artifact.title,
  };
}

function removeArtifactRow(
  rows: InboxArtifactRow[],
  event: ArtifactDeleteEvent,
): InboxArtifactRow[] {
  const deletedId = artifactInboxId(event.conversationId, event.slug);
  return rows.filter((row) => row.id !== deletedId);
}

export function useArtifactInboxRows(
  visibleConversations: VisibleArtifactConversations,
) {
  const [rows, setRows] = useState<InboxArtifactRow[]>([]);
  const visibilityKey = visibleConversationsKey(visibleConversations);

  useEffect(() => {
    let mounted = true;
    let updateUnlisten: (() => void) | null = null;
    let deleteUnlisten: (() => void) | null = null;

    void onArtifactUpdate((event) => {
      if (
        artifactConversationIsVisible(
          event.conversationId,
          visibleConversations,
        )
      ) {
        return;
      }
      const nextRow = artifactRow(event);
      setRows((current) =>
        [nextRow, ...current.filter((row) => row.id !== nextRow.id)].slice(
          0,
          MAX_ARTIFACT_INBOX_ROWS,
        ),
      );
    }).then((unlisten) => {
      if (mounted) updateUnlisten = unlisten;
      else unlisten();
    });

    void onArtifactDelete((event) => {
      setRows((current) => removeArtifactRow(current, event));
    }).then((unlisten) => {
      if (mounted) deleteUnlisten = unlisten;
      else unlisten();
    });

    return () => {
      mounted = false;
      updateUnlisten?.();
      deleteUnlisten?.();
    };
  }, [visibilityKey]);

  const markRead = useCallback((ids: readonly string[]) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    setRows((current) =>
      current.map((row) =>
        idSet.has(row.id) && !row.read ? { ...row, read: true } : row,
      ),
    );
  }, []);

  const clearRead = useCallback(() => {
    setRows((current) => current.filter((row) => !row.read));
  }, []);

  return { rows, markRead, clearRead };
}
