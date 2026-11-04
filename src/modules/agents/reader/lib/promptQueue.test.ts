import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUE,
  editQueued,
  enqueue,
  type IdleSignals,
  isSettled,
  moveQueued,
  type PromptQueue,
  QUEUE_IN_FLIGHT_MS,
  QUEUE_SETTLE_MS,
  readyToSend,
  removeQueued,
  settleInFlight,
  takeNext,
} from "./promptQueue";

const item = (id: string) => ({ id, text: id, mentions: [], images: [] });
const ids = (q: PromptQueue) => q.items.map((i) => i.id);

const idle = (over: Partial<IdleSignals> = {}): IdleSignals => ({
  phase: "finished",
  dialog: false,
  activityWorking: false,
  idleSince: 0,
  now: QUEUE_SETTLE_MS,
  ...over,
});

describe("prompt queue", () => {
  it("enqueues, edits, removes and reorders", () => {
    let q = enqueue(
      enqueue(enqueue(EMPTY_QUEUE, item("a")), item("b")),
      item("c"),
    );
    q = editQueued(q, "b", "changed");
    expect(q.items[1].text).toBe("changed");
    expect(ids(moveQueued(q, "c", -1))).toEqual(["a", "c", "b"]);
    expect(ids(moveQueued(q, "a", -5))).toEqual(["a", "b", "c"]);
    expect(ids(moveQueued(q, "a", 9))).toEqual(["b", "c", "a"]);
    expect(moveQueued(q, "missing", 1)).toBe(q);
    expect(ids(removeQueued(q, "b"))).toEqual(["a", "c"]);
  });

  it("sends only when Claude has been idle long enough", () => {
    const q = enqueue(EMPTY_QUEUE, item("a"));
    expect(readyToSend(q, idle())).toBe(true);
    expect(readyToSend(EMPTY_QUEUE, idle())).toBe(false);
    expect(readyToSend(q, idle({ phase: "working" }))).toBe(false);
    expect(readyToSend(q, idle({ dialog: true }))).toBe(false);
    expect(readyToSend(q, idle({ activityWorking: true }))).toBe(false);
    expect(readyToSend(q, idle({ idleSince: null }))).toBe(false);
    expect(readyToSend(q, idle({ now: QUEUE_SETTLE_MS - 1 }))).toBe(false);
    expect(isSettled(idle({ phase: "attention" }))).toBe(true);
  });

  it("holds the next item while one is in flight, until work starts or it times out", () => {
    let q = enqueue(enqueue(EMPTY_QUEUE, item("a")), item("b"));
    const taken = takeNext(q, 1_000);
    expect(taken.item?.id).toBe("a");
    q = taken.queue;
    expect(ids(q)).toEqual(["b"]);
    expect(readyToSend(q, idle({ now: 2_000 }))).toBe(false);
    expect(readyToSend(q, idle({ now: 1_000 + QUEUE_IN_FLIGHT_MS }))).toBe(
      true,
    );
    expect(settleInFlight(q, "working").inFlight).toBeNull();
    expect(settleInFlight(q, "finished")).toBe(q);
    expect(takeNext(EMPTY_QUEUE, 0).item).toBeNull();
  });
});
