import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileVersions, headFileChanges, revertFile, revertTarget } from "../src/git";

let repo: string;
const allow = () => true;

beforeAll(() => {
  repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "reader-git-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("git port", () => {
  it("rejects paths that could escape the repo", async () => {
    expect(await revertTarget(repo, "../x")).toBeNull();
    expect(await revertTarget(repo, "/etc/passwd")).toBeNull();
    expect(await revertTarget(repo, "-rf")).toBeNull();
    expect(await revertTarget(repo, "a:b")).toBeNull();
    expect(await revertTarget(repo, "a.txt")).toBe("a.txt");
    expect(await revertTarget(repo, "new/dir/file.ts")).toBe("new/dir/file.ts");
  });

  it("reports changes, versions, and reverts", async () => {
    writeFileSync(path.join(repo, "a.txt"), "one\nTWO\nthree\n");
    writeFileSync(path.join(repo, "b.txt"), "new\n");
    const changes = await headFileChanges(repo, ["a.txt", "b.txt", "../nope"], allow);
    expect(changes.map((c) => [c.path, c.inHead, c.added, c.removed])).toEqual([
      ["a.txt", true, 2, 1],
      ["b.txt", false, 1, 0],
    ]);
    expect(changes[0].diffText).toContain("+TWO");
    const v = await fileVersions(repo, "a.txt", allow);
    expect(v).toEqual({ head: "one\ntwo\n", working: "one\nTWO\nthree\n", binary: false });
    expect(await revertFile(repo, "a.txt", false, allow)).toBe("restored");
    await expect(revertFile(repo, "b.txt", false, allow)).rejects.toThrow(/new since HEAD/u);
    expect(await revertFile(repo, "b.txt", true, allow)).toBe("deleted");
    expect(await headFileChanges(repo, ["a.txt"], allow)).toMatchObject([{ added: 0, removed: 0 }]);
  });

  it("refuses repos outside the allowed roots", async () => {
    await expect(fileVersions(repo, "a.txt", () => false)).rejects.toThrow(/outside/u);
  });
});

describe("fsWriteReviewed", () => {
  it("saves inside the allowed folders only, keeping the file mode", async () => {
    const { fsWriteReviewed } = await import("../src/commands");
    const { chmodSync, readFileSync, statSync } = await import("node:fs");
    const file = path.join(repo, "a.txt");
    chmodSync(file, 0o640);
    await fsWriteReviewed(file, "edited\n", [repo]);
    expect(readFileSync(file, "utf8")).toBe("edited\n");
    expect(statSync(file).mode & 0o777).toBe(0o640);
    await expect(fsWriteReviewed(file, "x", ["/nowhere"])).rejects.toThrow(/outside/u);
    await expect(fsWriteReviewed("relative.txt", "x", [repo])).rejects.toThrow(/absolute/u);
  });
});
