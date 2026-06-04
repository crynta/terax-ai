import { describe, expect, it } from "vitest";
import { createPiControllerStore } from "./PiControllerProvider";

describe("PiControllerProvider store", () => {
  it("retains panel values across surface remount reads", () => {
    const store = createPiControllerStore();

    expect(store.get("prompt", "")).toBe("");
    store.set("prompt", "draft prompt");

    expect(store.get("prompt", "")).toBe("draft prompt");
  });

  it("applies functional updates against retained values", () => {
    const store = createPiControllerStore();

    store.set("keyRefreshToken", 1);
    store.set("keyRefreshToken", (current) => current + 1);

    expect(store.get("keyRefreshToken", 0)).toBe(2);
  });

  it("retains prewarm and regenerate branch coordination state", () => {
    const store = createPiControllerStore();

    expect(store.getPrewarmAttempted()).toBe(false);
    store.setPrewarmAttempted(true);
    store.regenerateBranches.set("session-1", {
      groupId: "branch-1",
      index: 1,
      regeneratedFromEventId: "event-1",
    });

    expect(store.getPrewarmAttempted()).toBe(true);
    expect(store.regenerateBranches.get("session-1")?.groupId).toBe("branch-1");
  });
});
