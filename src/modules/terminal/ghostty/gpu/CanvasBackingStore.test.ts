import { describe, expect, it } from "vitest";
import { CanvasBackingStore } from "./CanvasBackingStore";

describe("CanvasBackingStore", () => {
  it("releases hidden canvas storage while retaining the exact next presentation size", () => {
    const canvas = fakeCanvas(300, 150);
    const backing = new CanvasBackingStore(canvas);
    backing.stage(3840, 2160, 1920, 1080);
    backing.commit();
    backing.release();
    expect(canvas).toMatchObject({
      width: 1,
      height: 1,
      style: { width: "1920px", height: "1080px" },
    });
    expect(backing.pending).toBe(true);
    backing.stage(2560, 1440, 1280, 720);
    backing.commit();
    expect(canvas).toMatchObject({ width: 2560, height: 1440 });
    expect(backing.pending).toBe(false);
  });

  it("keeps presented pixels intact until the render transaction commits", () => {
    const canvas = fakeCanvas(300, 150);
    const backing = new CanvasBackingStore(canvas);

    expect(backing.stage(900, 540, 450, 270)).toBe(true);

    expect(canvas).toMatchObject({
      width: 300,
      height: 150,
      style: { width: "", height: "" },
    });
    expect(backing.pending).toBe(true);

    expect(backing.commit()).toBe(true);
    expect(canvas).toMatchObject({
      width: 900,
      height: 540,
      style: { width: "450px", height: "270px" },
    });
    expect(backing.pending).toBe(false);
  });

  it("coalesces resize steps before touching the intrinsic canvas", () => {
    const canvas = fakeCanvas(300, 150);
    const backing = new CanvasBackingStore(canvas);

    backing.stage(600, 300, 300, 150);
    backing.stage(800, 400, 400, 200);
    backing.stage(700, 350, 350, 175);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    backing.commit();
    expect(canvas.width).toBe(700);
    expect(canvas.height).toBe(350);
  });

  it("does not clear an already correctly sized backing store", () => {
    let intrinsicWrites = 0;
    let width = 640;
    let height = 480;
    const canvas = {
      get width() {
        return width;
      },
      set width(value: number) {
        intrinsicWrites += 1;
        width = value;
      },
      get height() {
        return height;
      },
      set height(value: number) {
        intrinsicWrites += 1;
        height = value;
      },
      style: { width: "", height: "" },
    };
    const backing = new CanvasBackingStore(canvas);

    expect(backing.stage(640, 480, 320, 240)).toBe(true);
    expect(backing.stage(640, 480, 320, 240)).toBe(false);

    expect(backing.pending).toBe(true);
    expect(backing.commit()).toBe(true);
    expect(canvas).toMatchObject({
      width: 640,
      height: 480,
      style: { width: "320px", height: "240px" },
    });
    expect(intrinsicWrites).toBe(0);
  });

  it("keeps intrinsic and CSS sizes exact while shrinking", () => {
    const canvas = fakeCanvas(1_024, 768);
    canvas.style.width = "512px";
    canvas.style.height = "384px";
    const backing = new CanvasBackingStore(canvas);

    expect(backing.stage(700, 500, 350, 250)).toBe(true);
    expect(backing.commit()).toBe(true);
    expect(canvas).toMatchObject({
      width: 700,
      height: 500,
      style: { width: "350px", height: "250px" },
    });
  });
});

function fakeCanvas(width: number, height: number) {
  return { width, height, style: { width: "", height: "" } };
}
