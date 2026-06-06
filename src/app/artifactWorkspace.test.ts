import { describe, expect, it } from "vitest";
import type { PiAgentSessionState } from "@/modules/agents/lib/types";
import { artifactWorkspaceTabInput } from "./artifactWorkspace";

const session = (title: string): PiAgentSessionState => ({
  lastActivityAt: 100,
  sessionId: "pi-1",
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
});
