import type { Tab } from "./tabs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({
  ref: { current: new Map<string | null, string>() },
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => harness.ref,
  useEffect: (run: () => void) => {
    harness.effects.push(run);
  },
}));
import { useWorkspaceCwd } from "./useWorkspaceCwd";

function render(projectId: string, tab?: Tab, fallback?: string) {
  let result!: ReturnType<typeof useWorkspaceCwd>;
  function Probe() {
    result = useWorkspaceCwd(tab, fallback, `/${projectId}`, projectId);
    return null;
  }
  renderToString(createElement(Probe));
  harness.effects.splice(0).forEach((run) => run());
  return result;
}
beforeEach(() => {
  harness.ref.current.clear();
});
it("remembers terminal directories separately across project switches", () => {
  const terminal: Tab = {
    id: 1,
    kind: "terminal",
    spaceId: "a",
    title: "shell",
    cwd: "/a/nested",
  };
  expect(render("a", terminal).explorerRoot).toBe("/a/nested");
  const other = render("b", undefined, "/b/terminal");
  expect(other.explorerRoot).toBe("/b/terminal");
  expect(other.inheritedCwdForNewTab()).toBe("/b/terminal");
  const back = render("a");
  expect(back.explorerRoot).toBe("/a/nested");
  expect(back.inheritedCwdForNewTab()).toBe("/a/nested");
  expect(render("c").explorerRoot).toBe("/c");
});
