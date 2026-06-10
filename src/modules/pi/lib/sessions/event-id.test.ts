/**
 * Webview event ids must carry a monotonic sequence so that events emitted
 * within the same millisecond order deterministically. Random UUIDs don't, which
 * left intra-turn events (input/output/tool) sorting by random id comparison —
 * corrupting transcript reconstruction on fork/rollback.
 */
import { describe, expect, it } from "vitest";
import {
  comparePiSessionEventsAscending,
  eventSequence,
  nextPiEventId,
} from "./events";
import type { PiSessionEvent } from "./types";

describe("nextPiEventId", () => {
  it("produces ids the sequence parser understands, strictly increasing", () => {
    const a = eventSequence({ id: nextPiEventId() } as PiSessionEvent);
    const b = eventSequence({ id: nextPiEventId() } as PiSessionEvent);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b as number).toBeGreaterThan(a as number);
  });

  it("orders same-timestamp events by emission order, deterministically", () => {
    const createdAt = "2026-06-10T00:00:00.000Z";
    const first: PiSessionEvent = {
      id: nextPiEventId(),
      type: "session.output.delta",
      sessionId: "s",
      createdAt,
      payload: { text: "1" },
    };
    const second: PiSessionEvent = {
      id: nextPiEventId(),
      type: "session.output.delta",
      sessionId: "s",
      createdAt,
      payload: { text: "2" },
    };
    // Ascending order is emission order regardless of input order.
    expect(comparePiSessionEventsAscending(first, second)).toBeLessThan(0);
    expect(comparePiSessionEventsAscending(second, first)).toBeGreaterThan(0);
  });
});
