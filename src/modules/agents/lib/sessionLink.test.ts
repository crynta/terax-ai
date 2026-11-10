import { describe, expect, it } from "vitest";
import { claudeSessionOf } from "./sessionLink";

const ID = "0b5f4c2e-9a1d-4e3b-8c7f-1234567890ab";

describe("claudeSessionOf", () => {
  it("links a Claude hook's session id", () => {
    expect(claudeSessionOf({ agent: "claude", sessionId: ID })).toBe(ID);
  });

  it("ignores other agents, missing ids and anything but a UUID", () => {
    expect(claudeSessionOf({ agent: "codex", sessionId: ID })).toBeNull();
    expect(claudeSessionOf({ agent: "claude" })).toBeNull();
    expect(claudeSessionOf({ agent: "claude", sessionId: "../../etc" })).toBeNull();
  });
});
