import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { EditorStack } from "@/modules/editor/EditorStackLazy";
import { AiDiffStack } from "@/modules/editor/AiDiffStackLazy";
import { GitDiffStack } from "@/modules/editor/GitDiffStackLazy";
import { MarkdownStack } from "@/modules/markdown/MarkdownStackLazy";
import { GitHistoryStack } from "@/modules/git-history/GitHistoryStackLazy";

const loads = vi.hoisted(() => ({
  editor: vi.fn(),
  ai: vi.fn(),
  git: vi.fn(),
  markdown: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/modules/editor/EditorStack", () => {
  loads.editor();
  return { EditorStack: () => null };
});
vi.mock("@/modules/editor/AiDiffStack", () => {
  loads.ai();
  return { AiDiffStack: () => null };
});
vi.mock("@/modules/editor/GitDiffStack", () => {
  loads.git();
  return { GitDiffStack: () => null };
});
vi.mock("@/modules/markdown/MarkdownStack", () => {
  loads.markdown();
  return { MarkdownStack: () => null };
});
vi.mock("@/modules/git-history/GitHistoryStack", () => {
  loads.history();
  return { GitHistoryStack: () => null };
});

const stacks = [
  EditorStack,
  AiDiffStack,
  GitDiffStack,
  MarkdownStack,
  GitHistoryStack,
];
function render(stack: (typeof stacks)[number], tabs: unknown[], activeId = 1) {
  return renderToString(
    createElement(
      stack as ComponentType<{ tabs: unknown[]; activeId: number }>,
      { tabs, activeId },
    ),
  );
}

it("does not import unused features when rendering a terminal or cold restored tabs", async () => {
  const tabs = [
    { id: 1, kind: "terminal" },
    { id: 2, kind: "editor", cold: true },
    { id: 3, kind: "markdown", cold: true },
    { id: 4, kind: "ai-diff" },
    { id: 5, kind: "git-diff" },
    { id: 6, kind: "git-history" },
  ];
  for (const stack of stacks) expect(render(stack, tabs)).toBe("");
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const load of Object.values(loads)) expect(load).not.toHaveBeenCalled();
});

it("loads each feature when its first live surface is needed", async () => {
  const kinds = [
    "editor",
    "ai-diff",
    "git-commit-file",
    "markdown",
    "git-history",
  ];
  stacks.forEach((stack, index) => {
    render(stack, [{ id: 1, kind: kinds[index] }]);
  });
  await vi.waitFor(() => {
    for (const load of Object.values(loads))
      expect(load).toHaveBeenCalledOnce();
  });
});
