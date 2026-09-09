import { expect, it, vi } from "vitest";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { TerminalScrollbarSync } from "@/modules/terminal/ghostty/gpu/terminalScrollbar";

it("does no DOM work for unchanged state and preserves fractional user scrolling", () => {
  let position = 60.4;
  const read = vi.fn(() => position);
  const write = vi.fn((value: number) => {
    position = value;
  });
  const attributes = new Map<string, string>();
  const scrollbar = {
    style: { visibility: "" },
    get scrollTop() {
      return read();
    },
    set scrollTop(value: number) {
      write(value);
    },
    getAttribute: vi.fn((name: string) => attributes.get(name)),
    setAttribute: vi.fn((name: string, value: string) =>
      attributes.set(name, value),
    ),
  };
  const content = { style: { height: "" } };
  const scroll = { history: 10, offset: 7 };
  const model = {
    scrollPosition: () => scroll,
    modes: () => ({ alternateScreen: false }),
  } as GhosttyTerminalModelApi;
  const cache = new TerminalScrollbarSync();
  const sync = (height = 100) =>
    cache.sync(
      height,
      scrollbar as unknown as HTMLElement,
      content as HTMLElement,
      model,
      20,
    );
  expect(sync()).toBe(60.4);
  expect(content.style.height).toBe("300px");
  read.mockClear();
  scrollbar.getAttribute.mockClear();
  for (let frame = 0; frame < 100; frame++) expect(sync()).toBe(60.4);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(scrollbar.getAttribute).not.toHaveBeenCalled();
  position = 80.6;
  cache.invalidate();
  scroll.offset = 6;
  expect(sync()).toBe(80.6);
  expect(write).not.toHaveBeenCalled();
  sync(120);
  expect(content.style.height).toBe("320px");
  scroll.offset = 0;
  expect(sync()).toBe(200);
  expect(write).toHaveBeenCalledExactlyOnceWith(200);
});
