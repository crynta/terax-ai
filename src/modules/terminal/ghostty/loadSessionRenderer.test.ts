import { expect, it, vi } from "vitest";
import { loadSessionRenderer } from "@/modules/terminal/ghostty/loadSessionRenderer";

it.each(["closed", "restarted", "model replaced", "surface replaced"])(
  "ignores late renderer imports and failures when %s",
  async (change) => {
    for (const fail of [false, true]) {
      const session = {
        disposed: false,
        generation: 1,
        model: {},
        surface: {},
      };
      let settle = () => {};
      const apply = vi.fn((renderer: object) => renderer);
      const loading = loadSessionRenderer(
        session,
        1,
        () =>
          new Promise<object>((resolve, reject) => {
            settle = () =>
              fail ? reject(new Error("unavailable chunk")) : resolve({});
          }),
        apply,
      );
      if (change === "closed") session.disposed = true;
      else if (change === "restarted") session.generation++;
      else if (change === "model replaced") session.model = {};
      else session.surface = {};
      settle();
      expect(await loading).toBeNull();
      expect(apply).not.toHaveBeenCalled();
    }
  },
);

it("loads only for a current generation and leaves failed imports retryable", async () => {
  const session = { disposed: false, generation: 1, model: {}, surface: {} };
  const renderer = {};
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("unavailable chunk"))
    .mockResolvedValue(renderer);
  expect(
    await loadSessionRenderer(session, 0, load, (value) => value),
  ).toBeNull();
  expect(load).not.toHaveBeenCalled();
  await expect(
    loadSessionRenderer(session, 1, load, (value) => value),
  ).rejects.toThrow("unavailable chunk");
  expect(await loadSessionRenderer(session, 1, load, (value) => value)).toBe(
    renderer,
  );
});

it("propagates installation failures even if installation changed the session", async () => {
  const session = { disposed: false, generation: 1, model: {}, surface: {} };
  await expect(
    loadSessionRenderer(
      session,
      1,
      async () => ({}),
      () => {
        session.surface = {};
        throw new Error("installation failed");
      },
    ),
  ).rejects.toThrow("installation failed");
});
