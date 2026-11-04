import type { Tab } from "@/modules/tabs/lib/tabs";
import { isMounted, View } from "@/modules/workbench/views/registry";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({
  editor: vi.fn(),
  preview: vi.fn(),
  markdown: vi.fn(),
  ai: vi.fn(),
  git: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/modules/workbench/views/TerminalView", () => ({
  TerminalView: () => null,
}));
vi.mock("@/modules/workbench/views/EditorView", () => {
  loads.editor();
  return { default: () => null };
});
vi.mock("@/modules/workbench/views/PreviewView", () => {
  loads.preview();
  return { default: () => null };
});
vi.mock("@/modules/workbench/views/MarkdownView", () => {
  loads.markdown();
  return { default: () => null };
});
vi.mock("@/modules/workbench/views/AiDiffView", () => {
  loads.ai();
  return { default: () => null };
});
vi.mock("@/modules/workbench/views/GitDiffView", () => {
  loads.git();
  return { default: () => null };
});
vi.mock("@/modules/workbench/views/GitHistoryView", () => {
  loads.history();
  return { default: () => null };
});

function render(tabs: Partial<Tab>[], visible: boolean) {
  for (const tab of tabs as Tab[]) {
    if (!isMounted(tab, visible)) continue;
    renderToString(createElement(View, { tab, visible, focused: visible }));
  }
}

it("does not import unused views for terminals, cold tabs or hidden transient tabs", async () => {
  render([{ id: 1, kind: "terminal" }], true);
  render(
    [
      { id: 2, kind: "editor", cold: true },
      { id: 3, kind: "markdown", cold: true },
      { id: 4, kind: "preview", cold: true },
    ],
    true,
  );
  render(
    [
      { id: 5, kind: "ai-diff" },
      { id: 6, kind: "git-diff" },
      { id: 7, kind: "git-history" },
    ],
    false,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const load of Object.values(loads)) expect(load).not.toHaveBeenCalled();
});

it("loads each view when its first live tab is shown", async () => {
  render(
    [
      { id: 1, kind: "editor" },
      { id: 2, kind: "preview" },
      { id: 3, kind: "markdown" },
      { id: 4, kind: "ai-diff" },
      { id: 5, kind: "git-commit-file" },
      { id: 6, kind: "git-history" },
    ],
    true,
  );
  await vi.waitFor(() => {
    for (const load of Object.values(loads))
      expect(load).toHaveBeenCalledOnce();
  });
});
