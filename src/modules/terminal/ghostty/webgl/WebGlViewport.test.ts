import { afterEach, expect, it, vi } from "vitest";
import { WebGlCellRenderer } from "@/modules/terminal/ghostty/webgl/WebGlCellRenderer";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";

afterEach(() => vi.unstubAllGlobals());

type MockGl = {
  methods: Map<string, ReturnType<typeof vi.fn>>;
  canvas: () => { width: number; height: number };
};

function stubWebGl(): MockGl {
  const methods = new Map<string, ReturnType<typeof vi.fn>>();
  const created: Array<{ width: number; height: number }> = [];
  const canvas = () => {
    expect(created.length).toBeGreaterThan(0);
    return created[0];
  };
  const gl = new Proxy(
    {},
    {
      get: (_, key: string) => {
        if (/^[A-Z_0-9]+$/.test(key)) return 1;
        if (key === "getUniformLocation") {
          let method = methods.get(key);
          if (!method) {
            method = vi.fn((_program: unknown, name: string) => ({ name }));
            methods.set(key, method);
          }
          return method;
        }
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
    createElement: () => {
      const element = Object.assign(new EventTarget(), {
        width: 1,
        height: 1,
        style: {},
        setAttribute() {},
        remove() {},
        getContext: (kind: string) => (kind === "webgl2" ? gl : {}),
      });
      created.push(element);
      return element;
    },
  });
  return { methods, canvas };
}

function blankModel(cursor = { x: 5, y: 3, visible: true, style: "block" }) {
  const dims = { cols: 80, rows: 24 };
  const model = {
    cursor: () => cursor,
    viewportOriginLine: () => 0,
    renderCells: () => ({
      length: dims.cols * dims.rows,
      width: () => 1,
      flags: () => 0,
      codepoint: () => 0,
      graphemeLength: () => 0,
      backgroundPacked: () => 0,
      foregroundPacked: () => 0xffffff,
      underlineColorPacked: () => 0,
      underlineStyle: () => 0,
      overline: () => false,
    }),
    resize: (cols: number, rows: number) => {
      dims.cols = cols;
      dims.rows = rows;
    },
  } as unknown as GhosttyTerminalModelApi & {
    resize: (cols: number, rows: number) => void;
  };
  return model;
}

function frameFor(model: GhosttyTerminalModelApi) {
  return {
    model,
    damage: { kind: "none" as const },
    cursorVisible: true,
    textBlinkVisible: true,
    selection: null,
    searchMatchAt: () => 0 as const,
  };
}

function profile() {
  return {
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
  } as const;
}

function lastCall(methods: MockGl["methods"], name: string): unknown[] {
  const calls = methods.get(name)?.mock.calls ?? [];
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as unknown[];
}

function lastUniform(
  methods: MockGl["methods"],
  setter: string,
  uniform: string,
): unknown[] {
  const calls = (methods.get(setter)?.mock.calls ?? []) as Array<
    [{ name: string }, ...unknown[]]
  >;
  const match = [...calls]
    .reverse()
    .find(([location]) => location?.name === uniform);
  expect(match, `${setter}(${uniform}) was issued`).toBeDefined();
  return (match as [{ name: string }, ...unknown[]]).slice(1);
}

it("binds the viewport to the grid sub-rectangle when the backing store outgrows it", () => {
  const { methods, canvas } = stubWebGl();
  const renderer = new WebGlCellRenderer();
  try {
    renderer.configure(
      profile(),
      () => {},
      () => {},
    );
    const model = blankModel();
    const frame = frameFor(model);
    renderer.resize(80, 24);
    expect(renderer.render(frame)).toBe(true);
    expect([canvas().width, canvas().height]).toEqual([640, 384]);
    expect(lastCall(methods, "viewport")).toEqual([0, 0, 640, 384]);

    // 81x25 needs 648x400; the store rounds up to 768x512.
    renderer.resize(81, 25);
    model.resize(81, 25);
    expect(renderer.render(frame)).toBe(true);
    expect([canvas().width, canvas().height]).toEqual([768, 512]);
    // The grid keeps the top-left of the canvas; WebGL viewports are bottom-up.
    expect(lastCall(methods, "viewport")).toEqual([0, 112, 648, 400]);
    expect(lastUniform(methods, "uniform2f", "u_resolution")).toEqual([
      648, 400,
    ]);
  } finally {
    renderer.dispose();
  }
});

it("re-binds the viewport when the grid shrinks inside retained slack", () => {
  const { methods, canvas } = stubWebGl();
  const renderer = new WebGlCellRenderer();
  try {
    renderer.configure(
      profile(),
      () => {},
      () => {},
    );
    const model = blankModel();
    const frame = frameFor(model);
    renderer.resize(80, 24);
    expect(renderer.render(frame)).toBe(true);

    // 79x23 needs 632x368; the 640x384 store is close enough to keep.
    renderer.resize(79, 23);
    model.resize(79, 23);
    expect(renderer.render(frame)).toBe(true);
    expect([canvas().width, canvas().height]).toEqual([640, 384]);
    expect(lastCall(methods, "viewport")).toEqual([0, 16, 632, 368]);
    expect(lastUniform(methods, "uniform2f", "u_resolution")).toEqual([
      632, 368,
    ]);
  } finally {
    renderer.dispose();
  }
});

it("offsets the cursor box by the viewport origin above the grid", () => {
  const { methods } = stubWebGl();
  const renderer = new WebGlCellRenderer();
  try {
    renderer.configure(
      profile(),
      () => {},
      () => {},
    );
    const model = blankModel();
    const frame = frameFor(model);
    renderer.resize(80, 24);
    expect(renderer.render(frame)).toBe(true);

    renderer.resize(81, 25);
    model.resize(81, 25);
    expect(renderer.render(frame)).toBe(true);
    // Block cursor on cell (5, 3); the grid starts 112px above the canvas bottom.
    expect(lastUniform(methods, "uniform4f", "u_cursor_box")).toEqual([
      40, -64, 48, -48,
    ]);
  } finally {
    renderer.dispose();
  }
});
