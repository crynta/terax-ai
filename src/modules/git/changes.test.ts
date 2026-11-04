import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./api", () => ({
  git: { watch: mocks.watch, unwatch: mocks.unwatch },
}));

import {
  createChangeDispatcher,
  GIT_CHANGED_EVENT,
  subscribeGitChanges,
} from "./changes";
import type { GitChangedEvent } from "./types";

describe("createChangeDispatcher", () => {
  it("routes an event to the handlers of its repository only", () => {
    const dispatcher = createChangeDispatcher();
    const a = vi.fn();
    const b = vi.fn();
    dispatcher.add("/repo/a", a);
    dispatcher.add("/repo/b", b);
    dispatcher.dispatch({ repo: "/repo/a", kinds: ["index"] });
    expect(a).toHaveBeenCalledWith(["index"]);
    expect(b).not.toHaveBeenCalled();
  });

  it("filters kinds per handler and skips handlers with nothing left", () => {
    const dispatcher = createChangeDispatcher();
    const everything = vi.fn();
    const refsOnly = vi.fn();
    dispatcher.add("/r", everything);
    dispatcher.add("/r", refsOnly, { kinds: ["refs", "head"] });
    dispatcher.dispatch({ repo: "/r", kinds: ["index", "worktree"] });
    expect(everything).toHaveBeenCalledWith(["index", "worktree"]);
    expect(refsOnly).not.toHaveBeenCalled();
    dispatcher.dispatch({ repo: "/r", kinds: ["head", "worktree"] });
    expect(refsOnly).toHaveBeenCalledWith(["head"]);
  });

  it("forgets a repository when its last handler is removed", () => {
    const dispatcher = createChangeDispatcher();
    const remove1 = dispatcher.add("/r", vi.fn());
    const remove2 = dispatcher.add("/r", vi.fn());
    expect(dispatcher.size).toBe(1);
    remove1();
    expect(dispatcher.size).toBe(1);
    remove2();
    remove2();
    expect(dispatcher.size).toBe(0);
  });

  it("lets a handler unsubscribe while being notified", () => {
    const dispatcher = createChangeDispatcher();
    const calls: string[] = [];
    const remove = dispatcher.add("/r", () => {
      calls.push("first");
      remove();
    });
    dispatcher.add("/r", () => calls.push("second"));
    dispatcher.dispatch({ repo: "/r", kinds: ["head"] });
    dispatcher.dispatch({ repo: "/r", kinds: ["head"] });
    expect(calls).toEqual(["first", "second", "second"]);
  });
});

describe("subscribeGitChanges", () => {
  let emit: (event: GitChangedEvent) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listen.mockImplementation(
      async (_name: string, cb: (e: { payload: GitChangedEvent }) => void) => {
        emit = (payload) => cb({ payload });
        return mocks.unlisten;
      },
    );
    mocks.watch.mockImplementation(async (repoRoot: string) => ({
      watching: true,
      repo: repoRoot,
      watchedDirs: 3,
      truncated: false,
      reason: null,
    }));
    mocks.unwatch.mockResolvedValue(undefined);
  });

  it("watches on the backend, delivers events and releases everything on unsubscribe", async () => {
    const handler = vi.fn();
    const unsubscribe = await subscribeGitChanges("/repo", handler);
    expect(mocks.watch).toHaveBeenCalledWith("/repo");
    expect(mocks.listen).toHaveBeenCalledWith(
      GIT_CHANGED_EVENT,
      expect.any(Function),
    );

    emit({ repo: "/repo", kinds: ["worktree"] });
    expect(handler).toHaveBeenCalledWith(["worktree"]);

    unsubscribe();
    unsubscribe();
    expect(mocks.unwatch).toHaveBeenCalledTimes(1);
    expect(mocks.unwatch).toHaveBeenCalledWith("/repo");
    await vi.waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
    emit({ repo: "/repo", kinds: ["worktree"] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shares one event listener between subscribers and keeps it until the last leaves", async () => {
    const one = await subscribeGitChanges("/repo", vi.fn());
    const two = await subscribeGitChanges("/other", vi.fn());
    expect(mocks.listen).toHaveBeenCalledTimes(1);
    one();
    await Promise.resolve();
    expect(mocks.unlisten).not.toHaveBeenCalled();
    two();
    await vi.waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
  });

  it("routes by the repository the backend resolved, not the path asked for", async () => {
    mocks.watch.mockResolvedValue({
      watching: true,
      repo: "/repo",
      watchedDirs: 1,
      truncated: false,
      reason: null,
    });
    const handler = vi.fn();
    const unsubscribe = await subscribeGitChanges("/repo/src/deep", handler);
    emit({ repo: "/repo", kinds: ["index"] });
    expect(handler).toHaveBeenCalledWith(["index"]);
    unsubscribe();
    expect(mocks.unwatch).toHaveBeenCalledWith("/repo/src/deep");
  });

  it("releases the listener when the backend refuses to watch", async () => {
    mocks.watch.mockRejectedValue(new Error("not a repository"));
    await expect(subscribeGitChanges("/nope", vi.fn())).rejects.toThrow(
      "not a repository",
    );
    await vi.waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
  });
});
