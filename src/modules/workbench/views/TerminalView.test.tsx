import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SpaceMeta } from "@/modules/spaces/lib/store";
const data = vi.hoisted(() => ({ spaces: [] as SpaceMeta[], pane: vi.fn() }));
vi.mock("@/modules/spaces/lib/useSpaces", () => ({
  useSpaces: Object.assign(
    (select: (s: { spaces: SpaceMeta[] }) => unknown) => select(data),
    { getState: () => data },
  ),
}));
vi.mock("@/modules/terminal/TerminalPane", () => ({
  TerminalPane: (props: unknown) => {
    data.pane(props);
    return <div>terminal</div>;
  },
}));
import { TerminalView } from "./TerminalView";
const render = () =>
  renderToString(
    createElement(TerminalView, {
      tab: { id: 1, kind: "terminal", spaceId: "p", title: "shell" },
      visible: true,
      focused: true,
    }),
  );
beforeEach(() => {
  data.spaces = [];
  data.pane.mockClear();
});
it("shows a recoverable error without spawning when project metadata is missing", () => {
  expect(render()).toContain("Project environment is unavailable");
  expect(data.pane).not.toHaveBeenCalled();
});
it("spawns with the configured project environment", () => {
  data.spaces = [
    {
      id: "p",
      name: "P",
      root: null,
      env: { kind: "wsl", distro: "Ubuntu" },
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  render();
  expect(data.pane).toHaveBeenCalledWith(
    expect.objectContaining({ workspace: { kind: "wsl", distro: "Ubuntu" } }),
  );
});
