import { describe, expect, it, vi } from "vitest";
import {
  createPersistenceWriter,
  WRITE_DEBOUNCE_MS,
  WRITE_MAX_WAIT_MS,
} from "./persistenceWriter";

function setup(initial: Record<string, unknown>) {
  const state = { ...initial };
  let clock = 0;
  let timer: { run: () => void; at: number } | null = null;
  const save = vi.fn(async () => {});
  const persist = vi.fn(async () => {});
  const writer = createPersistenceWriter({
    projects: () => Object.keys(state),
    serialize: (id) => state[id],
    save,
    persist,
    now: () => clock,
    setTimer: (run, ms) => {
      timer = { run, at: clock + ms };
      return timer;
    },
    clearTimer: () => {
      timer = null;
    },
  });
  const advance = async (ms: number) => {
    clock += ms;
    if (timer && timer.at <= clock) {
      const { run } = timer;
      timer = null;
      run();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { state, writer, save, persist, advance };
}

describe("workbench persistence writer", () => {
  it("writes changed projects only, and makes them durable", async () => {
    const { state, writer, save, persist } = setup({ a: 1, b: 1 });
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
    state.b = 2;
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith("b", 2);
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("waits for a quiet period after the last change", async () => {
    const { state, writer, save, advance } = setup({ a: 1 });
    writer.schedule();
    await advance(WRITE_DEBOUNCE_MS - 1);
    state.a = 2;
    writer.schedule();
    await advance(WRITE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("a", 2);
  });

  it("still writes during an endless stream of changes", async () => {
    const { state, writer, save, advance } = setup({ a: 0 });
    let elapsed = 0;
    while (save.mock.calls.length === 0 && elapsed <= WRITE_MAX_WAIT_MS) {
      state.a = elapsed;
      writer.schedule();
      await advance(1000);
      elapsed += 1000;
    }
    expect(save).toHaveBeenCalled();
    expect(elapsed).toBeLessThanOrEqual(WRITE_MAX_WAIT_MS);
  });
});
