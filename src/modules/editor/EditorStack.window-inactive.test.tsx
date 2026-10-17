import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EditorTab } from "@/modules/tabs";
import { EditorStack } from "./EditorStack";

vi.mock("@/modules/theme/WindowActivityBridge", () => ({
  useWindowInactive: vi.fn(),
}));

const { useWindowInactive } = await import("@/modules/theme/WindowActivityBridge");

vi.mock("./EditorPane", () => ({
  EditorPane: vi.fn(({ visible }: { visible: boolean }) => (
    <div data-testid="editor-pane" data-visible={visible ? "true" : "false"} />
  )),
}));

const baseTab: EditorTab = {
  id: 1,
  kind: "editor",
  title: "test.ts",
  path: "/test/test.ts",
  dirty: false,
  preview: false,
  spaceId: "default",
};

describe("EditorStack window inactive", () => {
  it("passes visible=false when window is inactive even if tab is active", async () => {
    vi.mocked(useWindowInactive).mockReturnValue(true);
    const html = renderToString(
      createElement(EditorStack, {
        tabs: [baseTab],
        activeId: 1,
        onDirtyChange: () => {},
        registerHandle: () => {},
        onCloseTab: () => {},
        onSetMarkdownView: () => {},
      }),
    );
    expect(html).toContain('data-visible="false"');
    vi.mocked(useWindowInactive).mockReset();
  });

  it("passes visible=true when tab is active and window is active", async () => {
    vi.mocked(useWindowInactive).mockReturnValue(false);
    const html = renderToString(
      createElement(EditorStack, {
        tabs: [baseTab],
        activeId: 1,
        onDirtyChange: () => {},
        registerHandle: () => {},
        onCloseTab: () => {},
        onSetMarkdownView: () => {},
      }),
    );
    expect(html).toContain('data-visible="true"');
    vi.mocked(useWindowInactive).mockReset();
  });
});
