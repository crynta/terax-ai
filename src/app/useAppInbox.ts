import { useCallback, useEffect, useMemo } from "react";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { onArtifactUpdate } from "@/modules/artifacts/lib/events";
import { useArtifactInboxRows } from "@/modules/inbox/hooks/useArtifactInboxRows";
import {
  buildInboxRows,
  countInboxUnread,
  type InboxRow,
} from "@/modules/inbox/lib/model";
import type { PiChatFocusRequest } from "@/modules/pi/PiChatPanel";
import type { SecondarySidebarViewId } from "@/modules/sidebar";
import { artifactWorkspaceTabInput } from "./artifactWorkspace";

type UseAppInboxInput = {
  chatSelectedSessionId: string | null;
  chatSidebarVisible: boolean;
  codePanelVisible: boolean;
  codeSelectedSessionId: string | null;
  onActivatePiSession: (sessionId: string) => void;
  openArtifactWorkspaceTab: (
    input: ReturnType<typeof artifactWorkspaceTabInput>,
  ) => number;
  openSecondarySidebarView: (view: SecondarySidebarViewId) => void;
  piSidebarVisible: boolean;
  setChatFocusRequest: (request: PiChatFocusRequest | null) => void;
};

export function useAppInbox({
  chatSelectedSessionId,
  chatSidebarVisible,
  codePanelVisible,
  codeSelectedSessionId,
  onActivatePiSession,
  openArtifactWorkspaceTab,
  openSecondarySidebarView,
  piSidebarVisible,
  setChatFocusRequest,
}: UseAppInboxInput) {
  const notifications = useAgentStore((state) => state.notifications);
  const piSessions = useAgentStore((state) => state.piSessions);
  const markNotificationsRead = useAgentStore(
    (state) => state.markNotificationsRead,
  );
  const markPiNotificationsRead = useAgentStore(
    (state) => state.markPiNotificationsRead,
  );
  const removeNotification = useAgentStore((state) => state.removeNotification);
  const visibleArtifactConversationIds = useMemo(
    () => [
      chatSidebarVisible ? chatSelectedSessionId : null,
      codePanelVisible ? codeSelectedSessionId : null,
    ],
    [
      chatSelectedSessionId,
      chatSidebarVisible,
      codePanelVisible,
      codeSelectedSessionId,
    ],
  );
  const artifactInbox = useArtifactInboxRows(visibleArtifactConversationIds);
  const piNotifications = useMemo(
    () => notifications.filter((notification) => notification.source === "pi"),
    [notifications],
  );
  const inboxRows = useMemo(
    () =>
      buildInboxRows({
        artifacts: artifactInbox.rows,
        notifications: piNotifications,
        piSessions,
      }),
    [artifactInbox.rows, piNotifications, piSessions],
  );
  const inboxUnreadCounts = useMemo(
    () =>
      countInboxUnread({
        artifacts: artifactInbox.rows,
        notifications: piNotifications,
      }),
    [artifactInbox.rows, piNotifications],
  );

  const openArtifactWorkspace = useCallback(
    (conversationId: string, selectedSlug: string | null = null) => {
      return openArtifactWorkspaceTab(
        artifactWorkspaceTabInput({
          conversationId,
          piSessions,
          selectedSlug,
        }),
      );
    },
    [openArtifactWorkspaceTab, piSessions],
  );

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;
    void onArtifactUpdate((event) => {
      const matchesVisibleChat =
        chatSidebarVisible && event.conversationId === chatSelectedSessionId;
      const matchesSelectedCode =
        codePanelVisible && event.conversationId === codeSelectedSessionId;
      if (matchesVisibleChat || matchesSelectedCode) {
        openArtifactWorkspace(event.conversationId, event.artifact.slug);
      }
    }).then((nextUnlisten) => {
      if (mounted) unlisten = nextUnlisten;
      else nextUnlisten();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [
    chatSelectedSessionId,
    chatSidebarVisible,
    codePanelVisible,
    codeSelectedSessionId,
    openArtifactWorkspace,
  ]);

  useEffect(() => {
    if (piSidebarVisible) {
      markPiNotificationsRead("code-run");
    }
  }, [markPiNotificationsRead, piSidebarVisible]);

  const markInboxRowsRead = useCallback(
    (rowIds: readonly string[]) => {
      const notificationIds: string[] = [];
      const artifactIds: string[] = [];
      for (const rowId of rowIds) {
        if (rowId.startsWith("notification:")) {
          notificationIds.push(rowId.slice("notification:".length));
        } else if (rowId.startsWith("artifact:")) {
          artifactIds.push(rowId);
        }
      }
      markNotificationsRead(notificationIds);
      artifactInbox.markRead(artifactIds);
    },
    [artifactInbox.markRead, markNotificationsRead],
  );

  const clearReadInboxRows = useCallback(() => {
    for (const row of inboxRows) {
      if (!row.read || !row.id.startsWith("notification:")) continue;
      removeNotification(row.id.slice("notification:".length));
    }
    artifactInbox.clearRead();
  }, [artifactInbox.clearRead, inboxRows, removeNotification]);

  const openInboxRow = useCallback(
    (row: InboxRow) => {
      if (!row.action) {
        markInboxRowsRead([row.id]);
        return;
      }
      if (row.action.type === "open-artifact") {
        openArtifactWorkspace(row.action.sessionId, row.action.slug);
      } else if (row.scope === "chat") {
        setChatFocusRequest({
          sessionId: row.action.sessionId,
          token: Date.now(),
        });
        openSecondarySidebarView("chat");
      } else {
        onActivatePiSession(row.action.sessionId);
      }
      markInboxRowsRead([row.id]);
    },
    [
      markInboxRowsRead,
      onActivatePiSession,
      openArtifactWorkspace,
      openSecondarySidebarView,
      setChatFocusRequest,
    ],
  );

  return {
    clearReadInboxRows,
    inboxRows,
    inboxUnreadCounts,
    markInboxRowsRead,
    openArtifactWorkspace,
    openInboxRow,
  };
}
