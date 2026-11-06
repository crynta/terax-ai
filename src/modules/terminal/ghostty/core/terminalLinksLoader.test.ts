import { afterEach, describe, expect, it, vi } from "vitest";

const instance = { invalidate: vi.fn(), dispose: vi.fn() };
// biome-ignore lint/complexity/useArrowFunction: it is called with `new`
const LazyTerminalLinks = vi.fn(function () {
  return instance;
});

vi.mock("./LazyTerminalLinks", () => ({ LazyTerminalLinks }));

import type { LazyTerminalLinksOptions } from "./LazyTerminalLinks";
import { deferTerminalLinks } from "./terminalLinksLoader";

afterEach(() => vi.clearAllMocks());

const options = {} as LazyTerminalLinksOptions;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("deferTerminalLinks", () => {
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

  it("tears down the trigger of a surface disposed while the module loaded", async () => {
    const links = deferTerminalLinks(options);
    links.dispose();
    await tick();
    expect(instance.dispose).toHaveBeenCalledOnce();
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
