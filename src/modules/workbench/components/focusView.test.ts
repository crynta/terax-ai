import { afterEach, expect, it, vi } from "vitest";
import { focusView } from "./focusView";

const slot = {
  tagName: "DIV",
  closest: () => true,
  contains: (node: unknown) => node === slot || node === editorInput,
  focus: vi.fn(),
} as unknown as HTMLElement;
const editorInput = { tagName: "TEXTAREA", closest: () => true };
const handle = { focus: vi.fn() };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("hands focus from a loading slot to the editor when its handle arrives", () => {
  vi.stubGlobal("document", {
    activeElement: { tagName: "BODY", closest: () => null },
  });
  focusView(slot);
  expect(slot.focus).toHaveBeenCalledWith({ preventScroll: true });
  vi.stubGlobal("document", { activeElement: slot });
  focusView(slot, handle);
  expect(handle.focus).toHaveBeenCalledOnce();
});

it("does not reclaim focus moved to the sidebar or reset an already focused editor", () => {
  vi.stubGlobal("document", {
    activeElement: { tagName: "INPUT", closest: () => null },
  });
  focusView(slot, handle);
  vi.stubGlobal("document", { activeElement: editorInput });
  focusView(slot, handle);
  expect(handle.focus).not.toHaveBeenCalled();
});
