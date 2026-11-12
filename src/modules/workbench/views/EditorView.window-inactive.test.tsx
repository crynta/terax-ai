import type { EditorTab } from "@/modules/tabs/lib/tabs";
import { useWindowInactive } from "@/modules/theme/WindowActivityBridge";
import { isWindowInactive } from "@/modules/theme/windowActivity";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import EditorView from "./EditorView";
import { WorkbenchChromeContext } from "../chrome";

const editorClose = vi.hoisted(() => ({ current: () => {} }));

vi.mock("@/modules/theme/WindowActivityBridge", () => ({
  useWindowInactive: vi.fn(),
}));

vi.mock("@/modules/editor/EditorPane", () => ({
  EditorPane: ({
    mediaActive,
    onClose,
  }: {
    mediaActive: boolean;
    onClose: () => void;
  }) => {
    editorClose.current = onClose;
    return <div data-media-active={mediaActive} />;
  },
}));

function renderEditor(path: string, visible = true) {
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
    createElement(EditorView, { tab, visible, focused: visible }),
  );
}

afterEach(() => vi.clearAllMocks());

describe("EditorView media", () => {
  it.each([
    "code.ts",
    "notes.md",
    "image.png",
    "document.pdf",
    "video.mp4",
    "audio.mp3",
  ])("pauses %s media while another app has focus", (name) => {
    vi.mocked(useWindowInactive).mockReturnValue(
      isWindowInactive({
        focused: false,
        documentVisible: true,
        presentationVisible: true,
      }),
    );
    expect(renderEditor(`/test/${name}`)).toContain(
      'data-media-active="false"',
    );
  });

  it.each([false, true])(
    "pauses media of a hidden tab when window inactivity is %s",
    (inactive) => {
      vi.mocked(useWindowInactive).mockReturnValue(inactive);
      expect(renderEditor("/test/video.mp4", false)).toContain(
        'data-media-active="false"',
      );
    },
  );

  it("plays media in a shown tab of an active window", () => {
    vi.mocked(useWindowInactive).mockReturnValue(false);
    expect(renderEditor("/test/video.mp4")).toContain(
      'data-media-active="true"',
    );
  });
});

it("routes editor close requests through the workbench confirmation guard", () => {
  const closeTab = vi.fn();
  const chrome = {
    closeTab,
    closeTabs() {},
    newEditor() {},
    newGitGraph() {},
    launchAgents() {},
    newTerminalCwd: () => undefined,
  };
  const tab: EditorTab = {
    id: 42,
    spaceId: "p",
    kind: "editor",
    title: "dirty",
    path: "/dirty.ts",
    dirty: true,
    preview: false,
  };
  renderToString(
    createElement(
      WorkbenchChromeContext.Provider,
      { value: chrome },
      createElement(EditorView, { tab, visible: true, focused: true }),
    ),
  );
  editorClose.current();
  expect(closeTab).toHaveBeenCalledExactlyOnceWith(42);
});
