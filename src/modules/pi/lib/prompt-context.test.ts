/**
 * Tests for prompt context + project memory injection (webview Pi agent).
 *
 * The webview agent was blind to IDE context: the prompt context (workspace
 * root, active file, terminal cwd) and TERAX.md project memory were dropped,
 * unlike the sidecar and Vercel AI SDK paths. These helpers mirror the Vercel
 * transport's `<env>` block + capped TERAX.md injection.
 */
import { describe, expect, it } from "vitest";
import {
  buildPromptWithContext,
  formatPiEnvBlock,
  readProjectMemory,
  withProjectMemory,
} from "./prompt-context";

describe("formatPiEnvBlock", () => {
  it("returns null when there is no context", () => {
    expect(formatPiEnvBlock(undefined)).toBeNull();
    expect(formatPiEnvBlock({})).toBeNull();
  });

  it("formats the available context fields", () => {
    expect(
      formatPiEnvBlock({
        workspaceRoot: "/ws",
        activeTerminalCwd: "/ws/src",
        activeFile: "/ws/src/a.ts",
      }),
    ).toBe(
      "<env>\nworkspace_root: /ws\nactive_terminal_cwd: /ws/src\nactive_file: /ws/src/a.ts\n</env>",
    );
  });

  it("marks a private terminal", () => {
    expect(
      formatPiEnvBlock({ workspaceRoot: "/ws", activeTerminalPrivate: true }),
    ).toBe("<env>\nworkspace_root: /ws\nactive_terminal_mode: private\n</env>");
  });
});

describe("buildPromptWithContext", () => {
  it("prepends the env block to the prompt", () => {
    expect(
      buildPromptWithContext("do the thing", { workspaceRoot: "/ws" }),
    ).toBe("<env>\nworkspace_root: /ws\n</env>\n\ndo the thing");
  });

  it("returns the prompt unchanged when there is no context", () => {
    expect(buildPromptWithContext("hi", null)).toBe("hi");
    expect(buildPromptWithContext("hi", {})).toBe("hi");
  });
});

describe("readProjectMemory", () => {
  it("returns TERAX.md content from the workspace root", async () => {
    const read = async (path: string) =>
      path === "/ws/TERAX.md" ? "project rules" : null;
    expect(await readProjectMemory("/ws", read)).toBe("project rules");
  });

  it("caps content at the size limit", async () => {
    const huge = "x".repeat(40 * 1024);
    const read = async () => huge;
    const result = await readProjectMemory("/ws", read);
    expect(result?.length).toBe(32 * 1024);
  });

  it("returns null when there is no workspace root or no file", async () => {
    expect(await readProjectMemory(null, async () => "x")).toBeNull();
    expect(await readProjectMemory("/ws", async () => null)).toBeNull();
  });

  it("never throws if the reader fails", async () => {
    const read = async () => {
      throw new Error("boom");
    };
    expect(await readProjectMemory("/ws", read)).toBeNull();
  });
});

describe("withProjectMemory", () => {
  it("appends a project-memory block to the system prompt", () => {
    expect(withProjectMemory("base", "rules")).toBe(
      "base\n\n<project-memory>\nrules\n</project-memory>",
    );
  });

  it("returns the system prompt unchanged when there is no memory", () => {
    expect(withProjectMemory("base", null)).toBe("base");
  });
});
