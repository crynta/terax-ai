import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cap,
  encodeProjectDir,
  isSessionId,
  parseLine,
  readPage,
  setProjectsRootForTests,
  transcriptFind,
  transcriptList,
  transcriptRead,
  transcriptPrompts,
  transcriptSearch,
  editedInSession,
} from "../src/transcript";

const ID = "0b6c2a1e-3f4d-4e5a-9b8c-7d6e5f4a3b2c";
const CWD = "/Users/me/my.repo";

const user = (text: string, uuid: string) =>
  JSON.stringify({ parentUuid: null, type: "user", uuid, message: { role: "user", content: text } });
const assistant = (text: string, uuid: string) =>
  JSON.stringify({
    parentUuid: "u1",
    type: "assistant",
    uuid,
    message: {
      model: "claude-opus-5-5",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "reader-test-"));
  const dir = path.join(root, encodeProjectDir(CWD));
  mkdirSync(dir);
  file = path.join(dir, `${ID}.jsonl`);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "file-history-snapshot", snapshot: { big: "x".repeat(1000) } }),
      user("fix the build please", "u1"),
      assistant("Looking now.", "a1"),
      JSON.stringify({ type: "ai-title", aiTitle: "Fix the build" }),
      "",
    ].join("\n"),
  );
  setProjectsRootForTests(root);
});

afterAll(() => {
  setProjectsRootForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe("transcript port", () => {
  it("validates ids and encodes project folders like Claude", () => {
    expect(isSessionId(ID)).toBe(true);
    expect(isSessionId("../../etc/passwd")).toBe(false);
    expect(encodeProjectDir("/Users/a.b/x_y")).toBe("-Users-a-b-x-y");
  });

  it("caps on UTF-8 bytes at a char boundary", () => {
    expect(cap("ééé", 3)).toBe("é…");
    expect(cap("abc", 3)).toBe("abc");
  });

  it("reads the tail, skipping bookkeeping lines", async () => {
    const page = await transcriptRead(ID, null, null);
    expect(page.entries.map((e) => e.kind)).toEqual(["user", "assistant", "title"]);
    const a = page.entries[1];
    expect(a.model).toBe("claude-opus-5-5");
    expect(a.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(a.blocks?.map((b) => b.type)).toEqual(["thinking", "text", "toolUse"]);
    expect(page.entries[2].text).toBe("Fix the build");
  });

  it("follows new lines from nextOffset and waits on a partial line", async () => {
    const first = await transcriptRead(ID, null, null);
    appendFileSync(file, `${user("and run tests", "u2")}\n{"parentUuid":"x","type":"user"`);
    const next = await transcriptRead(ID, first.nextOffset, null);
    expect(next.entries.map((e) => e.uuid)).toEqual(["u2"]);
    const again = await transcriptRead(ID, next.nextOffset, null);
    expect(again.entries).toEqual([]);
    expect(again.nextOffset).toBe(next.nextOffset);
  });

  it("resets when the offset is past the end", async () => {
    const page = await readPage(file, 10 ** 9, null);
    expect(page.reset).toBe(true);
  });

  it("finds, lists and searches sessions for a cwd", async () => {
    expect(await transcriptFind(CWD, 0)).toBe(ID);
    expect(await transcriptFind(CWD, Date.now() + 60_000)).toBeNull();
    // A session another pane owns is never guessed.
    expect(await transcriptFind(CWD, 0, [ID])).toBeNull();
    const [summary] = await transcriptList(CWD, 10);
    expect(summary).toMatchObject({
      sessionId: ID,
      title: "Fix the build",
      firstPrompt: "fix the build please",
      turns: 2,
    });
    const hits = await transcriptSearch(CWD, "BUILD");
    expect(hits).toEqual([{ sessionId: ID, snippet: "fix the build please" }]);
  });

  it("drops tool results' extra fields and keeps edit results", () => {
    const e = parseLine(
      Buffer.from(
        JSON.stringify({
          parentUuid: "a1",
          type: "user",
          uuid: "u3",
          message: {
            content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }] }],
          },
          toolUseResult: { filePath: "/a.ts", oldString: "a", newString: "b" },
        }),
      ),
    );
    expect(e?.blocks).toEqual([{ type: "toolResult", toolUseId: "t1", content: "ok", isError: false }]);
    expect(e?.toolUseResult).toEqual({ filePath: "/a.ts", oldString: "a", newString: "b" });
  });
});

describe("editedInSession", () => {
  it("vouches only for files this chat's Edit or Write calls touched", async () => {
    // A new line: an earlier test leaves a half-written one at the end.
    appendFileSync(
      file,
      `\n${JSON.stringify({
        parentUuid: "a1",
        type: "assistant",
        uuid: "a9",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t9",
              name: "Edit",
              input: { file_path: "/elsewhere/repo/x.ts", old_string: "a", new_string: "b" },
            },
            { type: "tool_use", id: "t10", name: "Read", input: { file_path: "/etc/hosts" } },
          ],
        },
      })}\n`,
    );
    expect(await editedInSession(ID, "/elsewhere/repo/x.ts")).toBe(true);
    expect(await editedInSession(ID, "/etc/hosts")).toBe(false);
    expect(await editedInSession(ID, "/elsewhere/repo/y.ts")).toBe(false);
    expect(await editedInSession("not-a-session", "/elsewhere/repo/x.ts")).toBe(false);
  });
});

describe("transcriptPrompts", () => {
  it("lists the prompts with their uuids, pasted text unwrapped", async () => {
    appendFileSync(
      file,
      `${user('<pasted_content id="9f">\n│ grid\n</pasted_content id="9f">\nwhy?', "u9")}\n`,
    );
    const prompts = await transcriptPrompts(ID);
    expect(prompts.map((p) => [p.uuid, p.text])).toEqual([
      ["u1", "fix the build please"],
      ["u2", "and run tests"],
      ["u9", "│ grid\n\n\nwhy?"],
    ]);
  });
});
