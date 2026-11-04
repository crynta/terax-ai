import type { EditorPaneHandle } from "@/modules/editor/EditorPane";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetViewHandles,
  setViewHandle,
  subscribeViewHandles,
  useViewHandle,
  viewHandle,
} from "./viewHandles";

const editor = (name: string) => ({ name }) as unknown as EditorPaneHandle;

afterEach(() => {
  forgetViewHandles(1);
  forgetViewHandles(2);
});

describe("view handle registry", () => {
  it("notifies subscribers on every registration change, and only then", () => {
    const listener = vi.fn();
    const off = subscribeViewHandles(listener);
    const a = editor("a");
    setViewHandle(1, "editor", a);
    setViewHandle(1, "editor", a);
    expect(listener).toHaveBeenCalledTimes(1);
    setViewHandle(1, "editor", null);
    setViewHandle(1, "editor", null);
    expect(listener).toHaveBeenCalledTimes(2);
    setViewHandle(2, "editor", editor("b"));
    forgetViewHandles(2);
    forgetViewHandles(2);
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    setViewHandle(1, "editor", a);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keeps kinds of one tab independent", () => {
    const a = editor("a");
    setViewHandle(1, "editor", a);
    setViewHandle(1, "preview", { focusAddressBar() {} } as never);
    setViewHandle(1, "preview", null);
    expect(viewHandle(1, "editor")).toBe(a);
    expect(viewHandle(1, "preview")).toBeUndefined();
  });

  it("the hook reads the registry at render, through the compiled component path", () => {
    function Probe({ id }: { id: number }) {
      const handle = useViewHandle(id, "editor") as
        | { name?: string }
        | undefined;
      return createElement("span", null, handle?.name ?? "none");
    }
    expect(renderToString(createElement(Probe, { id: 1 }))).toContain("none");
    setViewHandle(1, "editor", editor("registered"));
    expect(renderToString(createElement(Probe, { id: 1 }))).toContain(
      "registered",
    );
  });
});
