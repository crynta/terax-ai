import { afterEach, describe, expect, it, vi } from "vitest";

const instance = { ingest: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() };
// biome-ignore lint/complexity/useArrowFunction: it is called with `new`
const LazyTerminalLinks = vi.fn(function () {
  return instance;
});

vi.mock("./LazyTerminalLinks", () => ({ LazyTerminalLinks }));

import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";
import { deferTerminalLinks } from "./terminalLinksLoader";

afterEach(() => vi.clearAllMocks());

const options = {
  target: Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 384 }),
  }),
  keyTarget: new EventTarget(),
  model: { revision: () => revision, viewportOriginLine: () => 0 },
  geometry: () => ({ cellWidth: 8, cellHeight: 16, shiftY: 0 }),
} as unknown as LazyTerminalLinksOptions;
let revision = 1;
afterEach(() => {
  revision = 1;
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deferTerminalLinks", () => {
  it("does not replay a click onto output replaced during the first import", async () => {
    const links = deferTerminalLinks(options);
    options.target.dispatchEvent(new Event("pointerdown"));
    revision++;
    options.target.dispatchEvent(new Event("pointerup"));
    await tick();
    expect(instance.ingest).not.toHaveBeenCalled();
    links.dispose();
  });
  it("builds the trigger once the module arrived and forwards to it", async () => {
    const links = deferTerminalLinks(options);
    links.invalidate();
    expect(instance.invalidate).not.toHaveBeenCalled();
    await tick();
    expect(LazyTerminalLinks).toHaveBeenCalledWith(options);
    links.invalidate();
    expect(instance.invalidate).toHaveBeenCalledOnce();
    links.dispose();
    await tick();
    expect(instance.dispose).toHaveBeenCalledOnce();
  });

  it("never creates a trigger for a surface disposed while the module loaded", async () => {
    const links = deferTerminalLinks(options);
    links.dispose();
    await tick();
    expect(LazyTerminalLinks).not.toHaveBeenCalled();
  });

  it("preserves clicks and modifier changes during the first module load", async () => {
    const links = deferTerminalLinks(options);
    const events = [
      new Event("pointerdown"),
      new Event("pointerup"),
      new Event("keyup"),
    ];
    options.target.dispatchEvent(events[0]);
    options.target.dispatchEvent(events[1]);
    (options.keyTarget as Window).dispatchEvent(events[2]);
    await tick();
    expect(instance.ingest.mock.calls.map(([event]) => event)).toEqual(events);
    links.dispose();
  });

  it("reports a trigger that fails to start instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // biome-ignore lint/complexity/useArrowFunction: it is called with `new`
    LazyTerminalLinks.mockImplementationOnce(function () {
      throw new Error("boom");
    });
    const links = deferTerminalLinks(options);
    await tick();
    expect(error).toHaveBeenCalledOnce();
    expect(() => {
      links.invalidate();
      links.dispose();
    }).not.toThrow();
    error.mockRestore();
  });
});
