import type { EditorTab } from "@/modules/tabs";
import { useWindowInactive } from "@/modules/theme/WindowActivityBridge";
import { isWindowInactive } from "@/modules/theme/windowActivity";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorStack } from "./EditorStack";

vi.mock("@/modules/theme/WindowActivityBridge", () => ({
  useWindowInactive: vi.fn(),
}));

vi.mock("./EditorPane", () => ({
  EditorPane: ({ mediaActive }: { mediaActive: boolean }) => (
    <div data-media-active={mediaActive} />
  ),
}));

function renderEditor(path: string, activeId = 1) {
  const tab: EditorTab = {
    id: 1,
    kind: "editor",
    title: path,
    path,
    dirty: false,
    preview: false,
    spaceId: "default",
  };
  return renderToString(
    createElement(EditorStack, {
      tabs: [tab],
      activeId,
      onDirtyChange: () => {},
      registerHandle: () => {},
      onCloseTab: () => {},
      onSetMarkdownView: () => {},
    }),
  );
}

afterEach(() => vi.clearAllMocks());

describe("EditorStack presentation", () => {
  it.each([
    "code.ts",
    "notes.md",
    "image.png",
    "document.pdf",
    "video.mp4",
    "audio.mp3",
  ])("keeps the active %s pane visible when another app has focus", (name) => {
    vi.mocked(useWindowInactive).mockReturnValue(
      isWindowInactive({
        focused: false,
        documentVisible: true,
        presentationVisible: true,
      }),
    );
    const html = renderEditor(`/test/${name}`);
    expect(html).not.toContain("invisible pointer-events-none");
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('data-media-active="false"');
  });

  it.each([false, true])(
    "hides inactive tabs when window inactivity is %s",
    (inactive) => {
      vi.mocked(useWindowInactive).mockReturnValue(inactive);
      const html = renderEditor("/test/video.mp4", 2);
      expect(html).toContain("invisible pointer-events-none");
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('data-media-active="false"');
    },
  );

  it("allows media in the active tab of an active window", () => {
    vi.mocked(useWindowInactive).mockReturnValue(false);
    const html = renderEditor("/test/video.mp4");
    expect(html).not.toContain("invisible pointer-events-none");
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('data-media-active="true"');
  });
});
