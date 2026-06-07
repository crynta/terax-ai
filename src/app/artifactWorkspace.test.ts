import { describe, expect, it } from "vitest";
import type { PiAgentSessionState } from "@/modules/agents/lib/types";
import {
  artifactWorkspaceConversationForLauncher,
  artifactWorkspaceTabInput,
} from "./artifactWorkspace";

const session = (
  title: string,
  sessionId = "pi-1",
  lastActivityAt = 100,
): PiAgentSessionState => ({
  lastActivityAt,
  sessionId,
  status: "idle",
  title,
});

describe("artifact workspace routing", () => {
  it("builds reusable artifact tab input from session metadata", () => {
    expect(
      artifactWorkspaceTabInput({
        conversationId: "pi-1",
        selectedSlug: "qa-react",
        piSessions: { "pi-1": session("QA session") },
      }),
    ).toEqual({
      conversationId: "pi-1",
      selectedSlug: "qa-react",
      title: "Artifacts · QA session",
    });
  });

  it("uses a named artifact tab for model compare exports", () => {
    expect(
      artifactWorkspaceTabInput({
        conversationId: "model-compare",
        selectedSlug: "cmp-abc",
        piSessions: {},
      }),
    ).toEqual({
      conversationId: "model-compare",
      selectedSlug: "cmp-abc",
      title: "Artifacts · Model Compare",
    });
  });

  it("falls back to a generic artifact tab title", () => {
    expect(
      artifactWorkspaceTabInput({
        conversationId: "pi-2",
        selectedSlug: null,
        piSessions: {},
      }),
    ).toEqual({
      conversationId: "pi-2",
      selectedSlug: null,
      title: "Artifacts",
    });
  });

  it("prefers the visible Code session for the artifact launcher", () => {
    expect(
      artifactWorkspaceConversationForLauncher({
        chatSelectedSessionId: "chat-1",
        chatSidebarVisible: true,
        codePanelVisible: true,
        codeSelectedSessionId: "code-1",
        piSessions: {},
        tabs: [],
      }),
    ).toBe("code-1");
  });

  it("falls back to visible Chat or existing artifact tabs for the launcher", () => {
    expect(
      artifactWorkspaceConversationForLauncher({
        chatSelectedSessionId: "chat-1",
        chatSidebarVisible: true,
        codePanelVisible: false,
        codeSelectedSessionId: "code-1",
        piSessions: {},
        tabs: [],
      }),
    ).toBe("chat-1");

    expect(
      artifactWorkspaceConversationForLauncher({
        chatSelectedSessionId: null,
        chatSidebarVisible: false,
        codePanelVisible: false,
        codeSelectedSessionId: null,
        piSessions: {},
        tabs: [
          {
            conversationId: "artifact-1",
            id: 2,
            kind: "artifact",
            selectedSlug: null,
            title: "Artifacts",
          },
        ],
      }),
    ).toBe("artifact-1");
  });

  it("uses the most recent Pi session when no surface is selected", () => {
    expect(
      artifactWorkspaceConversationForLauncher({
        chatSelectedSessionId: null,
        chatSidebarVisible: false,
        codePanelVisible: false,
        codeSelectedSessionId: null,
        piSessions: {
          old: session("Old", "old", 10),
          recent: session("Recent", "recent", 20),
        },
        tabs: [],
      }),
    ).toBe("recent");
  });
});
