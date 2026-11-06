import { beforeEach, describe, expect, it, vi } from "vitest";

const agentMock = vi.hoisted(() => ({
  runAgentStream: vi.fn(),
}));

vi.mock("./agent", () => agentMock);

const nativeMock = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock("./native", () => ({ native: nativeMock }));

import { createContextAwareTransport, stripContextBlock } from "./transport";
import type { UIMessage } from "@ai-sdk/react";

agentMock.runAgentStream.mockImplementation(() => ({
  toUIMessageStream: () => "stream-ok",
}));

function userMessage(text: string): UIMessage {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] };
}

function makeDeps(live: Record<string, unknown>) {
  return {
    getKeys: () => ({}) as never,
    toolContext: {} as never,
    getModelId: () => "gpt-test",
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => live as never,
  };
}

async function send(messages: UIMessage[], live: Record<string, unknown>) {
  const transport = createContextAwareTransport(makeDeps(live));
  await transport.sendMessages({ messages });
  const call =
    agentMock.runAgentStream.mock.calls[
      agentMock.runAgentStream.mock.calls.length - 1
    ][0];
  return call.uiMessages as UIMessage[];
}

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      const part = messages[i].parts[0] as { type: string; text?: string };
      if (part.type === "text") return part.text ?? "";
    }
  }
  throw new Error("no user text part");
}

describe("context-aware AI transport", () => {
  beforeEach(() => {
    agentMock.runAgentStream.mockClear();
    nativeMock.readFile.mockReset();
    nativeMock.readFile.mockRejectedValue(new Error("missing"));
  });

  it("strips a leading terminal-context block only", () => {
    expect(
      stripContextBlock(
        '<terminal-context cwd="/repo">\noutput\n</terminal-context>\nquestion',
      ),
    ).toBe("question");
    expect(stripContextBlock("keep <terminal-context>x</terminal-context>")).toBe(
      "keep <terminal-context>x</terminal-context>",
    );
  });

  it("injects an env block into the last user message without mutating input", async () => {
    const original = [userMessage("first"), userMessage("do the thing")];
    const snapshot = {
      workspaceRoot: "/repo",
      cwd: "/repo/sub",
      activeFile: "/repo/a.ts",
      terminalPrivate: true,
    };

    const out = await send(original, snapshot);

    expect(out).not.toBe(original);
    expect(lastUserText(out)).toBe(
      '<env>\nworkspace_root: /repo\nactive_terminal_cwd: /repo/sub\nactive_file: /repo/a.ts\nactive_terminal_mode: private\n</env>\n\ndo the thing',
    );
    expect(lastUserText(original)).toBe("do the thing");
    expect(out[0]).toBe(original[0]);
  });

  it("prepends a new text part when the user message has none", async () => {
    const messages = [
      {
        id: "u2",
        role: "user" as const,
        parts: [{ type: "file" as const, url: "file:///a.ts" }],
      },
    ];

    const out = await send(messages as UIMessage[], {
      workspaceRoot: "/repo-prepend",
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    });

    const parts = out[0].parts as { type: string; text?: string }[];
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toBe(
      "<env>\nworkspace_root: /repo-prepend\n</env>",
    );
  });

  it("passes messages untouched when no live context exists", async () => {
    const original = [userMessage("hello")];

    const out = await send(original, {
      workspaceRoot: null,
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    });

    expect(out).toBe(original);
  });

  it("reads TERAX.md from the workspace root as project memory", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "# Project rules",
    });

    await send([userMessage("hi")], {
      workspaceRoot: "/repo-read",
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    });

    expect(nativeMock.readFile).toHaveBeenCalledWith("/repo-read/TERAX.md");
    const call =
      agentMock.runAgentStream.mock.calls[
        agentMock.runAgentStream.mock.calls.length - 1
      ][0];
    expect(call.projectMemory).toBe("# Project rules");
  });

  it("caches project memory per workspace across sends", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "# Rules",
    });
    const live = {
      workspaceRoot: "/repo-cache",
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    };

    await send([userMessage("a")], live);
    await send([userMessage("b")], live);

    expect(nativeMock.readFile).toHaveBeenCalledTimes(1);
  });

  it("caches a failed read as no memory instead of retrying", async () => {
    nativeMock.readFile.mockRejectedValue(new Error("gone"));
    const live = {
      workspaceRoot: "/repo-fail",
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    };

    await send([userMessage("a")], live);
    await send([userMessage("b")], live);

    expect(nativeMock.readFile).toHaveBeenCalledTimes(1);
    const call =
      agentMock.runAgentStream.mock.calls[
        agentMock.runAgentStream.mock.calls.length - 1
      ][0];
    expect(call.projectMemory).toBeNull();
  });

  it("truncates oversized TERAX.md content to 32 KiB", async () => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "x".repeat(40 * 1024),
    });

    await send([userMessage("hi")], {
      workspaceRoot: "/big",
      cwd: null,
      activeFile: null,
      terminalPrivate: false,
    });

    const call =
      agentMock.runAgentStream.mock.calls[
        agentMock.runAgentStream.mock.calls.length - 1
      ][0];
    expect((call.projectMemory as string).length).toBe(32 * 1024);
  });
});
