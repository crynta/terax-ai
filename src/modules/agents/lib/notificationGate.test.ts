import { describe, expect, it } from "vitest";
import { createAgentNotificationGate } from "./notificationGate";

const TARGET = {
  source: "terminal",
  agent: "codex",
  kind: "attention",
  tabId: 7,
  leafId: 11,
};

describe("createAgentNotificationGate", () => {
  it("suppresses an immediate duplicate", () => {
    const shouldDeliver = createAgentNotificationGate(2_000);

    expect(shouldDeliver(TARGET, 1_000)).toBe(true);
    expect(shouldDeliver(TARGET, 2_999)).toBe(false);
    expect(shouldDeliver(TARGET, 3_000)).toBe(true);
  });

  it("keeps distinct targets and notification kinds independent", () => {
    const shouldDeliver = createAgentNotificationGate(2_000);

    expect(shouldDeliver(TARGET, 1_000)).toBe(true);
    expect(shouldDeliver({ ...TARGET, leafId: 12 }, 1_001)).toBe(true);
    expect(shouldDeliver({ ...TARGET, kind: "finished" }, 1_002)).toBe(true);
  });

  it("recovers when the system clock moves backward", () => {
    const shouldDeliver = createAgentNotificationGate(2_000);

    expect(shouldDeliver(TARGET, 5_000)).toBe(true);
    expect(shouldDeliver(TARGET, 4_000)).toBe(true);
  });

  it("bounds retained notification keys", () => {
    const shouldDeliver = createAgentNotificationGate(2_000, 2);

    expect(shouldDeliver(TARGET, 1_000)).toBe(true);
    expect(shouldDeliver({ ...TARGET, leafId: 12 }, 1_001)).toBe(true);
    expect(shouldDeliver({ ...TARGET, leafId: 13 }, 1_002)).toBe(true);
    expect(shouldDeliver(TARGET, 1_003)).toBe(true);
  });
});
