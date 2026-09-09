import { expect, it, vi } from "vitest";
import { LatestClipboardWrite } from "./LatestClipboardWrite";

it("keeps one in-flight clipboard write and only the latest pending value", async () => {
  let complete: (() => void) | undefined;
  const write = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const queue = new LatestClipboardWrite(write);
  queue.enqueue("first");
  await Promise.resolve();
  for (let index = 0; index < 1000; index++) queue.enqueue(String(index));
  expect(write).toHaveBeenCalledOnce();
  complete?.();
  await Promise.resolve();
  expect(write.mock.calls).toEqual([["first"], ["999"]]);
  complete?.();
  await Promise.resolve();
});
it("coalesces a parser burst and recovers from clipboard rejection", async () => {
  const write = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValue(undefined);
  const queue = new LatestClipboardWrite(write);
  queue.enqueue("old");
  queue.enqueue("new");
  await Promise.resolve();
  await Promise.resolve();
  expect(write).toHaveBeenCalledWith("new");
  queue.enqueue("recovered");
  await Promise.resolve();
  expect(write).toHaveBeenLastCalledWith("recovered");
});
