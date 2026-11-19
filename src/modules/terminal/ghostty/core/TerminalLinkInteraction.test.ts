import { describe, expect, it, vi } from "vitest";
import {
  type LinkCell,
  type LinkOverlay,
  TerminalLinkInteraction,
} from "./TerminalLinkInteraction";
import type { TerminalLinkHit } from "./terminalLinks";

type Flags = { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };

function pointerEvent(type: string, x: number, y: number, flags: Flags = {}) {
  const event = new Event(type, { cancelable: true });
  return Object.assign(event, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerType: "mouse",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...flags,
  });
}

const LINK: TerminalLinkHit = {
  kind: "url",
  uri: "https://example.com",
  text: "https://example.com",
  segments: [{ row: 1, start: 2, end: 21 }],
};

function setup(options: { blocked?: boolean } = {}) {
  const target = new EventTarget() as unknown as HTMLElement;
  const keys = new EventTarget();
  const overlay: LinkOverlay = { show: vi.fn(), hide: vi.fn() };
  const hitAt = vi.fn((cell: LinkCell) =>
    cell.row === 1 && cell.column >= 2 && cell.column < 21 ? LINK : null,
  );
  const onActivate = vi.fn();
  const setPointerCursor = vi.fn();
  let refresh: (() => void) | null = null;
  const interaction = new TerminalLinkInteraction({
    target,
    keyTarget: keys as unknown as Window,
    isModifier: (event) => event.metaKey || event.ctrlKey,
    cellAt: (x, y) => ({ row: Math.floor(y / 10), column: Math.floor(x / 10) }),
    blocked: () => options.blocked ?? false,
    hitAt,
    overlay,
    setPointerCursor,
    onActivate,
    schedule: (callback) => {
      refresh = callback;
    },
  });
  const fire = (type: string, x: number, y: number, flags?: Flags) => {
    const event = pointerEvent(type, x, y, flags);
    target.dispatchEvent(event);
    return event;
  };
  return {
    interaction,
    keys,
    overlay,
    hitAt,
    onActivate,
    setPointerCursor,
    fire,
    flush: () => refresh?.(),
  };
}

describe("TerminalLinkInteraction", () => {
  it("does no work and shows nothing without the modifier", () => {
    const t = setup();
    t.fire("pointermove", 50, 15);
    t.fire("pointerdown", 50, 15);
    t.fire("pointerup", 50, 15);
    expect(t.hitAt).not.toHaveBeenCalled();
    expect(t.overlay.show).not.toHaveBeenCalled();
    expect(t.onActivate).not.toHaveBeenCalled();
    expect(t.interaction.active).toBe(false);
  });

  it("underlines a link under the modifier and clears it off the link", () => {
    const t = setup();
    t.fire("pointermove", 50, 15, { metaKey: true });
    expect(t.overlay.show).toHaveBeenCalledWith(LINK);
    expect(t.setPointerCursor).toHaveBeenLastCalledWith(true);
    t.fire("pointermove", 55, 15, { metaKey: true });
    expect(t.overlay.show).toHaveBeenCalledTimes(1);
    t.fire("pointermove", 500, 15, { metaKey: true });
    expect(t.overlay.hide).toHaveBeenCalled();
    expect(t.setPointerCursor).toHaveBeenLastCalledWith(false);
  });

  it("reacts when the modifier is pressed and released over a link", () => {
    const t = setup();
    t.fire("pointermove", 50, 15);
    expect(t.overlay.show).not.toHaveBeenCalled();
    t.keys.dispatchEvent(
      Object.assign(new Event("keydown"), { metaKey: true }),
    );
    expect(t.overlay.show).toHaveBeenCalledWith(LINK);
    t.keys.dispatchEvent(Object.assign(new Event("keyup"), { metaKey: false }));
    expect(t.overlay.hide).toHaveBeenCalled();
  });

  it("activates on a modified click that starts and ends on the same link", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { ctrlKey: true });
    const up = t.fire("pointerup", 60, 15, { ctrlKey: true });
    expect(t.onActivate).toHaveBeenCalledWith(LINK);
    expect(up.defaultPrevented).toBe(true);
  });

  it("does not activate when the pointer left the link before release", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { metaKey: true });
    t.fire("pointerup", 400, 15, { metaKey: true });
    expect(t.onActivate).not.toHaveBeenCalled();
  });

  it("does not activate when the modifier was released before the button", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { metaKey: true });
    t.fire("pointerup", 50, 15);
    expect(t.onActivate).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons and touch", () => {
    const t = setup();
    const secondary = pointerEvent("pointerdown", 50, 15, { metaKey: true });
    Object.assign(secondary, { button: 2 });
    (t.interaction as unknown as { handleDown(e: Event): void }).handleDown(
      secondary,
    );
    t.fire("pointerup", 50, 15, { metaKey: true });
    expect(t.onActivate).not.toHaveBeenCalled();
    const touch = pointerEvent("pointermove", 50, 15, { metaKey: true });
    Object.assign(touch, { pointerType: "touch" });
    t.fire("pointermove", 500, 500);
    (t.interaction as unknown as { handleMove(e: Event): void }).handleMove(
      touch,
    );
    expect(t.overlay.show).not.toHaveBeenCalled();
  });

  it("stands aside while the surface says the pointer is not its own", () => {
    const t = setup({ blocked: true });
    t.fire("pointermove", 50, 15, { metaKey: true });
    t.fire("pointerdown", 50, 15, { metaKey: true });
    t.fire("pointerup", 50, 15, { metaKey: true });
    expect(t.hitAt).not.toHaveBeenCalled();
    expect(t.onActivate).not.toHaveBeenCalled();
  });

  it("looks again after output moved the text under a held modifier", () => {
    const t = setup();
    t.fire("pointermove", 50, 15, { metaKey: true });
    t.hitAt.mockReturnValue(null);
    t.interaction.invalidate();
    t.interaction.invalidate();
    t.flush();
    expect(t.hitAt).toHaveBeenCalledTimes(2);
    expect(t.overlay.hide).toHaveBeenCalled();
  });

  it("keeps a pressed link armed through the damage the press itself caused", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { metaKey: true });
    // Selecting on press damages the surface, which asks for a fresh look
    // before the button comes up.
    t.interaction.invalidate();
    t.flush();
    t.fire("pointerup", 50, 15, { metaKey: true });
    expect(t.onActivate).toHaveBeenCalledWith(LINK);
  });

  it("disarms a press when the text under it changed to something else", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { metaKey: true });
    t.hitAt.mockReturnValue({
      ...LINK,
      uri: "https://other.example",
      text: "https://other.example",
    });
    t.interaction.invalidate();
    t.flush();
    t.fire("pointerup", 50, 15, { metaKey: true });
    expect(t.onActivate).not.toHaveBeenCalled();

    const gone = setup();
    gone.fire("pointerdown", 50, 15, { metaKey: true });
    gone.hitAt.mockReturnValue(null);
    gone.interaction.invalidate();
    gone.flush();
    gone.fire("pointerup", 50, 15, { metaKey: true });
    expect(gone.onActivate).not.toHaveBeenCalled();
  });

  it("takes over a press, release and key change that happened while it loaded", () => {
    const key = (type: string, metaKey: boolean) =>
      Object.assign(new Event(type), {
        metaKey,
        ctrlKey: false,
        shiftKey: false,
      });
    const t = setup();
    t.interaction.ingest(
      pointerEvent("pointerdown", 50, 15, { metaKey: true }),
    );
    t.interaction.ingest(pointerEvent("pointerup", 50, 15, { metaKey: true }));
    expect(t.onActivate).toHaveBeenCalledWith(LINK);

    const late = setup();
    late.interaction.ingest(pointerEvent("pointermove", 50, 15));
    late.interaction.ingest(key("keydown", true));
    expect(late.overlay.show).toHaveBeenCalledWith(LINK);
    late.interaction.ingest(key("keyup", false));
    expect(late.overlay.hide).toHaveBeenCalled();
  });

  it.each([false, true])(
    "rechecks the destination before release even with pending damage (%s)",
    (same) => {
      const t = setup();
      t.fire("pointerdown", 50, 15, { metaKey: true });
      t.hitAt.mockReturnValue(
        same ? { ...LINK } : { ...LINK, uri: "https://changed.test" },
      );
      t.interaction.invalidate();
      t.fire("pointerup", 50, 15, { metaKey: true });
      expect(t.hitAt).toHaveBeenCalledTimes(2);
      expect(t.onActivate).toHaveBeenCalledTimes(same ? 1 : 0);
      t.flush();
      expect(t.onActivate).toHaveBeenCalledTimes(same ? 1 : 0);
    },
  );

  it("follows the modifier after a press that came with no earlier movement", () => {
    const t = setup();
    t.fire("pointerdown", 50, 15, { metaKey: true });
    t.keys.dispatchEvent(Object.assign(new Event("keyup"), { metaKey: false }));
    expect(t.overlay.hide).toHaveBeenCalled();
  });

  it("drops the highlight on leave, blur and dispose, and unbinds key listeners", () => {
    const t = setup();
    t.fire("pointermove", 50, 15, { metaKey: true });
    t.fire("pointerleave", 50, 15);
    expect(t.overlay.hide).toHaveBeenCalledTimes(1);
    t.fire("pointermove", 50, 15, { metaKey: true });
    t.keys.dispatchEvent(new Event("blur"));
    expect(t.overlay.hide).toHaveBeenCalledTimes(2);
    t.interaction.dispose();
    t.fire("pointermove", 50, 15, { metaKey: true });
    expect(t.overlay.show).toHaveBeenCalledTimes(2);
  });
});
