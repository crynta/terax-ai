import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { navigateEditor } from "./editorNavigation";
import { canFocusTab } from "./viewFocus";
import { setViewHandle, forgetViewHandles } from "./viewHandles";
import { useWorkbench } from "./store";
import { EMPTY_WORKBENCH } from "./model/workbench";
import { card } from "./model/layout";

beforeEach(() => {
  useWorkbench.setState({
    ...EMPTY_WORKBENCH,
    activeProjectId: "p",
    activeTaskByProject: { p: 10 },
    tabs: [
      {
        id: 1,
        kind: "editor",
        spaceId: "p",
        title: "file",
        path: "/file",
        dirty: false,
        preview: false,
      },
    ],
    tasks: [
      {
        id: 10,
        kind: "main",
        projectId: "p",
        createdAt: 0,
        layout: card(11, [1], 1),
        focusedCardId: 11,
        maximizedCardId: null,
      },
    ],
  });
  vi.stubGlobal("document", {
    activeElement: { tagName: "BODY", closest: () => null },
  });
});
afterEach(() => {
  forgetViewHandles(1);
  vi.unstubAllGlobals();
});

it.each(["project", "sidebar"])(
  "positions a queued line without stealing focus after moving to another %s",
  (target) => {
    navigateEditor(1, { line: 42, focus: true });
    if (target === "project")
      useWorkbench.setState({ activeProjectId: "other" });
    else
      vi.stubGlobal("document", {
        activeElement: { tagName: "INPUT", closest: () => null },
      });
    const gotoLine = vi.fn();
    setViewHandle(1, "editor", { gotoLine } as never);
    expect(gotoLine).toHaveBeenCalledExactlyOnceWith(42, { focus: false });
    expect(canFocusTab(1)).toBe(false);
  },
);
