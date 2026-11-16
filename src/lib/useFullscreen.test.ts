import { describe, expect, it } from "vitest";
import { registerFullscreenSync } from "./useFullscreen";

describe("registerFullscreenSync", () => {
  it("registers resize tracking before the initial fullscreen read", async () => {
    const calls: string[] = [];
    const values: boolean[] = [];
    const window = {
      async onResized(_handler: () => void) {
        calls.push("listen");
        return () => {};
      },
      async isFullscreen() {
        calls.push("read");
        return true;
      },
    };

    await registerFullscreenSync(window, (value) => values.push(value));

    expect(calls).toEqual(["listen", "read"]);
    expect(values).toEqual([true]);
  });

  it("does not let an older fullscreen read overwrite a newer resize read", async () => {
    let resize: (() => void) | undefined;
    const resolvers: Array<(value: boolean) => void> = [];
    const values: boolean[] = [];
    const window = {
      async onResized(handler: () => void) {
        resize = handler;
        return () => {};
      },
      isFullscreen() {
        return new Promise<boolean>((resolve) => resolvers.push(resolve));
      },
    };

    const registration = registerFullscreenSync(window, (value) =>
      values.push(value),
    );
    await Promise.resolve();
    expect(resize).toBeDefined();
    expect(resolvers).toHaveLength(1);

    resize?.();
    expect(resolvers).toHaveLength(2);

    resolvers[1]?.(true);
    await Promise.resolve();
    resolvers[0]?.(false);
    await registration;

    expect(values).toEqual([true]);
  });
});
