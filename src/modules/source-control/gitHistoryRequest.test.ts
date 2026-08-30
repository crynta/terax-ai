import { describe, expect, it } from "vitest";
import { createGitHistoryRequestGate } from "./gitHistoryRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("Git history request ownership", () => {
  it("does not open an A request after switching to Space B", async () => {
    const gate = createGitHistoryRequestGate();
    const pending = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const request = gate.begin("space-a", "local", "/repos/a");
    const complete = pending.promise.then((repo) => {
      if (gate.isCurrent(request, "space-b", "local", "/repos/b")) {
        opened.push(repo.repoRoot);
      }
    });

    pending.resolve({ repoRoot: "/repos/a" });
    await complete;

    expect(opened).toEqual([]);
  });

  it("does not open a delayed request after switching Spaces with the same root", async () => {
    const gate = createGitHistoryRequestGate();
    const pending = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const request = gate.begin("space-a", "local", "/repos/shared");
    const complete = pending.promise.then((repo) => {
      if (gate.isCurrent(request, "space-b", "local", "/repos/shared")) {
        opened.push(repo.repoRoot);
      }
    });

    pending.resolve({ repoRoot: "/repos/shared" });
    await complete;

    expect(opened).toEqual([]);
  });

  it("does not open a delayed request for the same root after Local switches to WSL", async () => {
    const gate = createGitHistoryRequestGate();
    const pending = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const request = gate.begin("space-a", "local", "/repos/shared");
    const complete = pending.promise.then((repo) => {
      if (gate.isCurrent(request, "space-a", "wsl:Ubuntu", "/repos/shared")) {
        opened.push(repo.repoRoot);
      }
    });

    pending.resolve({ repoRoot: "/repos/shared" });
    await complete;

    expect(opened).toEqual([]);
  });

  it("invalidates a delayed request when ownership changes and changes back", async () => {
    const gate = createGitHistoryRequestGate();
    const pending = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const request = gate.begin("space-a", "local", "/repos/shared");
    const complete = pending.promise.then((repo) => {
      if (gate.isCurrent(request, "space-a", "local", "/repos/shared")) {
        opened.push(repo.repoRoot);
      }
    });

    gate.invalidate();
    pending.resolve({ repoRoot: "/repos/shared" });
    await complete;

    expect(opened).toEqual([]);
  });

  it("does not open a stale request after the Space root changes", async () => {
    const gate = createGitHistoryRequestGate();
    const pending = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const request = gate.begin("space-a", "local", "/repos/old");
    const complete = pending.promise.then((repo) => {
      if (gate.isCurrent(request, "space-a", "local", "/repos/new")) {
        opened.push(repo.repoRoot);
      }
    });

    pending.resolve({ repoRoot: "/repos/old" });
    await complete;

    expect(opened).toEqual([]);
  });

  it("allows only a newer request to open after it supersedes an older resolution", async () => {
    const gate = createGitHistoryRequestGate();
    const first = deferred<{ repoRoot: string }>();
    const second = deferred<{ repoRoot: string }>();
    const opened: string[] = [];
    const firstRequest = gate.begin("space-a", "local", "/repos/a");
    const secondRequest = gate.begin("space-a", "local", "/repos/a");
    const complete = (
      request: typeof firstRequest,
      pending: Promise<{ repoRoot: string }>,
    ) =>
      pending.then((repo) => {
        if (gate.isCurrent(request, "space-a", "local", "/repos/a")) {
          opened.push(repo.repoRoot);
        }
      });

    const firstCompletion = complete(firstRequest, first.promise);
    const secondCompletion = complete(secondRequest, second.promise);
    second.resolve({ repoRoot: "/repos/newer" });
    await secondCompletion;
    first.resolve({ repoRoot: "/repos/older" });
    await firstCompletion;

    expect(opened).toEqual(["/repos/newer"]);
  });
});
