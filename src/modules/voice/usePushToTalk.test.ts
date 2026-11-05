import { describe, expect, it } from "vitest";
import type { VoiceHoldMods } from "@/modules/settings/store";
import { modsHeld } from "./usePushToTalk";

function key(over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...over,
  } as KeyboardEvent;
}

const CTRL_ALT: VoiceHoldMods = { ctrl: true, alt: true };

describe("modsHeld", () => {
  it("matches the exact configured combination", () => {
    expect(modsHeld(key({ ctrlKey: true, altKey: true }), CTRL_ALT)).toBe(true);
  });

  it("rejects a partial match", () => {
    expect(modsHeld(key({ ctrlKey: true }), CTRL_ALT)).toBe(false);
  });

  it("rejects an extra modifier so it cannot steal other chords", () => {
    expect(
      modsHeld(key({ ctrlKey: true, altKey: true, shiftKey: true }), CTRL_ALT),
    ).toBe(false);
  });

  it("never matches when no modifier is configured", () => {
    expect(modsHeld(key(), {})).toBe(false);
    expect(modsHeld(key({ ctrlKey: true }), {})).toBe(false);
  });
});
