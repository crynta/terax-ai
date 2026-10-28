import { afterEach, expect, it, vi } from "vitest";
import { schedulePtyParse } from "@/modules/terminal/lib/ptyParseScheduler";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  const events: (() => void)[] = [];
  const ports: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = { onmessage: null as (() => void) | null, close: vi.fn() };
      port2 = {
        close: vi.fn(),
        postMessage: () => {
          const handler = this.port1.onmessage;
          events.push(() => handler?.());
        },
      };
      constructor() {
        ports.push(this.port1, this.port2);
      }
    },
  );
  return { ports, run: () => events.shift()?.(), events };
}

it("yields between terminals in FIFO order and closes both ports when idle", () => {
  const h = harness();
  const parsed: string[] = [];
  schedulePtyParse(() => {
    parsed.push("first slice");
    schedulePtyParse(() => parsed.push("first continuation"));
  });
  schedulePtyParse(() => parsed.push("second terminal"));
  expect(h.events).toHaveLength(1);
  h.run();
  h.run();
  h.run();
  expect(parsed).toEqual([
    "first slice",
    "second terminal",
    "first continuation",
  ]);
  expect(h.events).toHaveLength(0);
  expect(h.ports).toHaveLength(2);
  for (const port of h.ports) expect(port.close).toHaveBeenCalledOnce();
});

it("cancels queued work and ignores a late event from a closed channel", () => {
  const h = harness();
  const cancelled = vi.fn();
  const current = vi.fn();
  schedulePtyParse(cancelled)();
  schedulePtyParse(current);
  h.run();
  expect(cancelled).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  h.run();
  expect(current).toHaveBeenCalledOnce();
  for (const port of h.ports) expect(port.close).toHaveBeenCalledOnce();
});
