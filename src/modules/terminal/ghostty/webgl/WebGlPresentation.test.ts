import { afterEach, expect, it, vi } from "vitest";
import { WebGlCellRenderer } from "@/modules/terminal/ghostty/webgl/WebGlCellRenderer";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";

afterEach(() => vi.unstubAllGlobals());

it("keeps unchanged WebGL frames idle, retains cursor buffers, and presents cached data on request", () => {
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const gl = new Proxy(
    {},
    {
      get: (_, key: string) => {
        if (/^[A-Z_0-9]+$/.test(key)) return 1;
        let method = methods.get(key);
        if (!method) {
          method = vi.fn(() => (key === "getExtension" ? null : {}));
          methods.set(key, method);
        }
        return method;
      },
    },
  );
  vi.stubGlobal("document", {
    createElement: () =>
      Object.assign(new EventTarget(), {
        width: 1,
        height: 1,
        style: {},
        setAttribute() {},
        remove() {},
        getContext: (kind: string) => (kind === "webgl2" ? gl : {}),
      }),
  });
  const renderer = new WebGlCellRenderer();
  const cursor = { x: 0, y: 0, visible: true, blinking: false, style: "block" };
  let background = 0;
  const model = {
    cols: 80,
    rows: 24,
    cursor: () => cursor,
    viewportOriginLine: () => 0,
    renderCells: () => ({
      length: 80 * 24,
      width: () => 1,
      flags: () => 0,
      codepoint: () => 0,
      backgroundPacked: () => background,
      foregroundPacked: () => 0xffffff,
      underlineColorPacked: () => 0,
      underlineStyle: () => 0,
      overline: () => false,
    }),
  } as unknown as GhosttyTerminalModelApi;
  try {
    renderer.configure(
      {
        metrics: {
          cellWidth: 8,
          cellHeight: 16,
          baseline: 12,
          font: {
            family: "monospace",
            size: 14,
            weight: "400",
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        },
        theme: {
          background: [0, 0, 0],
          foreground: [255, 255, 255],
          cursor: [255, 255, 255],
          selection: { color: [50, 50, 50], alpha: 0.5 },
          palette: [],
        },
        scale: 1,
      },
      () => {},
      () => {},
    );
    renderer.resize(80, 24);
    const frame = {
      model,
      damage: { kind: "none" as const },
      cursorVisible: true,
      textBlinkVisible: true,
      selection: null,
      searchMatchAt: () => 0 as const,
    };
    expect(renderer.render(frame)).toBe(true);
    const upload = methods.get("bufferData");
    const glyphUpload = methods.get("bufferSubData");
    const draw = methods.get("drawElementsInstanced");
    upload?.mockClear();
    glyphUpload?.mockClear();
    draw?.mockClear();
    for (let index = 0; index < 100; index++)
      expect(renderer.render(frame)).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    cursor.x++;
    expect(renderer.render(frame)).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(glyphUpload).not.toHaveBeenCalled();
    upload?.mockClear();
    renderer.requestPresentation();
    expect(renderer.render(frame)).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(glyphUpload).not.toHaveBeenCalled();
    cursor.visible = false;
    renderer.render(frame);
    draw?.mockClear();
    for (let index = 0; index < 100; index++)
      expect(
        renderer.render({ ...frame, cursorVisible: index % 2 === 0 }),
      ).toBe(false);
    expect(draw).not.toHaveBeenCalled();
    upload?.mockClear();
    glyphUpload?.mockClear();
    const rowDamage = {
      ...frame,
      damage: { kind: "rows" as const, ranges: [{ start: 3, end: 3 }] },
    };
    expect(renderer.render(rowDamage)).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    expect(glyphUpload).toHaveBeenCalledOnce();
    expect(glyphUpload?.mock.calls[0][2].byteLength).toBe(80 * 15 * 4);
    background = 0x112233;
    expect(renderer.render(rowDamage)).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload?.mock.calls[0][1].length).toBe(9);
    renderer.render({ ...frame, damage: { kind: "full" } });
    const rectangleBytes = renderer.diagnostics().uploadedRectangleBytes;
    upload?.mockClear();
    glyphUpload?.mockClear();
    background = 0x223344;
    renderer.render(rowDamage);
    expect(upload).not.toHaveBeenCalled();
    expect(renderer.diagnostics().uploadedRectangleBytes - rectangleBytes).toBe(
      36,
    );
    expect(
      glyphUpload?.mock.calls.some(
        (call) => call[1] === 3 * 36 && call[2].byteLength === 36,
      ),
    ).toBe(true);
    background = 0;
    upload?.mockClear();
    expect(renderer.render(rowDamage)).toBe(true);
    expect(upload).not.toHaveBeenCalled();
    cursor.visible = true;
    renderer.render(frame);
    renderer.canvas.dispatchEvent(new Event("webglcontextrestored"));
    upload?.mockClear();
    expect(renderer.render(frame)).toBe(true);
    expect(
      upload?.mock.calls.some(
        (call) => call[1] instanceof Float32Array && call[1].length === 9,
      ),
    ).toBe(true);
  } finally {
    renderer.dispose();
  }
});
