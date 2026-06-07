import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import {
  type ArtifactWorkspaceTab,
  type Tab,
  upsertArtifactHubTab,
  upsertArtifactWorkspaceTab,
} from "./useTabs";

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "terminal",
  paneTree: { kind: "leaf", id: 1 },
  activeLeafId: 1,
};

describe("artifact workspace tabs", () => {
  it("opens and dedupes the global artifact hub tab", () => {
    const opened = upsertArtifactHubTab([terminalTab], 2);
    expect(opened.activeId).toBe(2);
    expect(opened.tabs).toEqual([
      terminalTab,
      { id: 2, kind: "artifact-hub", title: "Artifacts" },
    ]);

    const reopened = upsertArtifactHubTab(opened.tabs, 3);
    expect(reopened.activeId).toBe(2);
    expect(reopened.tabs).toEqual(opened.tabs);
  });

  it("opens an artifact workspace tab for a conversation", () => {
    const result = upsertArtifactWorkspaceTab([terminalTab], 2, {
      conversationId: "pi_123",
      selectedSlug: "qa-react",
      title: "Artifacts · QA Session",
    });

    expect(result.activeId).toBe(2);
    expect(result.tabs).toEqual([
      terminalTab,
      {
        conversationId: "pi_123",
        id: 2,
        kind: "artifact",
        selectedSlug: "qa-react",
        title: "Artifacts · QA Session",
      },
    ]);
  });

  it("reuses the conversation artifact tab and updates the selected slug", () => {
    const existing: ArtifactWorkspaceTab = {
      conversationId: "pi_123",
      id: 2,
      kind: "artifact",
      selectedSlug: "qa-html",
      title: "Artifacts · QA Session",
    };

    const result = upsertArtifactWorkspaceTab([terminalTab, existing], 3, {
      conversationId: "pi_123",
      selectedSlug: "qa-react",
      title: "Artifacts · QA Session",
    });

    expect(result.activeId).toBe(2);
    expect(result.tabs).toEqual([
      terminalTab,
      { ...existing, selectedSlug: "qa-react" },
    ]);
  });

  it("uses the artifact title as its tab label", () => {
    expect(
      labelFor({
        conversationId: "pi_123",
        id: 2,
        kind: "artifact",
        selectedSlug: null,
        title: "Artifacts · QA Session",
      }),
    ).toBe("Artifacts · QA Session");
    expect(labelFor({ id: 3, kind: "artifact-hub", title: "Artifacts" })).toBe(
      "Artifacts",
    );
  });
});
