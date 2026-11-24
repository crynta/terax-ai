import { afterEach, expect, it, vi } from "vitest";
import { WebGlCellRenderer } from "@/modules/terminal/ghostty/webgl/WebGlCellRenderer";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { WebGlGlyphAtlas } from "./WebGlGlyphAtlas";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps unchanged WebGL frames idle, retains cursor buffers, and presents cached data on request", () => {
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const gl = new Proxy(
    {},
    {
      get: (_, key: string) => {
        if (/^[A-Z_0-9]+$/.test(key)) return 1;
        let method = methods.get(key);
        if (!method) {
          method = vi.fn((_, name) => {
            if (key === "getExtension") return null;
            if (key === "getUniformLocation") return name;
            return {};
          });
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
  let cellCount = 80 * 24;
  let glyphCell = -1;
  const model = {
    cols: 80,
    rows: 24,
    cursor: () => cursor,
    viewportOriginLine: () => 0,
    renderCells: () => ({
      length: cellCount,
      width: () => 1,
      flags: () => 0,
      codepoint: (index: number) => (index === glyphCell ? 65 : 0),
      graphemeLength: () => 0,
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
          scale: 1,
          deviceCellWidth: 8,
          deviceCellHeight: 16,
          deviceBaseline: 12,
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
          cursorText: [0, 0, 0],
          selection: { color: [50, 50, 50], alpha: 0.5 },
          palette: [],
        },
        scale: 1,
        contrast: { enhancedContrast: 0, alphaCorrection: 0 },
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

    // Shrink without replacing the backing store. The bottom row and cursor
    // must still be drawn within the visible 79-by-23 grid.
    cursor.y = 22;
    cellCount = 79 * 23;
    glyphCell = 22 * 79 + cursor.x;
    vi.spyOn(WebGlGlyphAtlas.prototype, "glyph").mockReturnValue({
      originOffsetX: 0,
      originOffsetY: 0,
      width: 7,
      height: 13,
      uvMinX: 0,
      uvMinY: 0,
      uvMaxX: 1,
      uvMaxY: 1,
      intrinsicColor: false,
      exact: false,
    });
    glyphUpload?.mockClear();
    renderer.resize(79, 23);
    expect(renderer.render(frame)).toBe(true);
    expect(renderer.canvas.width).toBe(640);
    expect(renderer.canvas.height).toBe(384);
    expect(methods.get("viewport")).toHaveBeenLastCalledWith(0, 16, 632, 368);
    expect(methods.get("uniform2f")).toHaveBeenCalledWith(
      "u_resolution",
      632,
      368,
    );
    expect(methods.get("uniform4f")).toHaveBeenCalledWith(
      "u_cursor_box",
      8,
      336,
      16,
      352,
    );
    const attributes = glyphUpload?.mock.calls.find(
      ([, offset, data]) =>
        offset === 0 &&
        data instanceof Float32Array &&
        data.length === cellCount * 15,
    )?.[2];
    expect(attributes?.[glyphCell * 15 + 2]).toBeCloseTo(7 / 632, 7);
    expect(attributes?.[glyphCell * 15 + 3]).toBeCloseTo(13 / 368, 7);
  } finally {
    renderer.dispose();
  }
});
