import { expect, it } from "vitest";
import { BoundedResourceTrace } from "@/modules/terminal/lib/BoundedResourceTrace";

it("retains only the latest 600 samples in chronological order", () => {
  const trace = new BoundedResourceTrace<number>();
  for (let index = 0; index < 10_000; index++) trace.record(index);
  const snapshot = trace.snapshot();
  expect(snapshot).toHaveLength(600);
  expect(snapshot[0]).toBe(9_400);
  expect(snapshot[599]).toBe(9_999);
  snapshot.length = 0;
  expect(trace.snapshot()).toHaveLength(600);
});
