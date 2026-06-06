import { describe, expect, it } from "vitest";
import { artifactConversationIsVisible } from "@/modules/inbox/hooks/useArtifactInboxRows";

describe("artifact inbox visibility", () => {
  it("treats any selected visible conversation as already handled", () => {
    expect(
      artifactConversationIsVisible("pi-code", ["pi-chat", "pi-code"]),
    ).toBe(true);
    expect(
      artifactConversationIsVisible("pi-other", ["pi-chat", "pi-code"]),
    ).toBe(false);
  });

  it("keeps the legacy single visible session behavior", () => {
    expect(artifactConversationIsVisible("pi-chat", "pi-chat")).toBe(true);
    expect(artifactConversationIsVisible("pi-code", null)).toBe(false);
  });
});
