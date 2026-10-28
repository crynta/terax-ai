import { describe, expect, it, vi } from "vitest";
import { CanvasBackingStore } from "./CanvasBackingStore";

function fakeCanvas(width: number, height: number) {
  return { width, height, style: { width: "", height: "" } };
}

describe("CanvasBackingStore", () => {
  it("keeps presented pixels intact until the render transaction commits", () => {
    const canvas = fakeCanvas(300, 150);
    const backing = new CanvasBackingStore(canvas);

    expect(backing.stage(900, 540, 2)).toBe(true);

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

    backing.stage(600, 300, 2);
    backing.stage(800, 400, 2);
    backing.stage(700, 350, 2);

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
      style: { width: "640px", height: "480px" },
    };
    const backing = new CanvasBackingStore(canvas);
    expect(backing.stage(640, 480, 1)).toBe(false);
    expect(backing.commit()).toBe(false);
    expect(intrinsicWrites).toBe(0);
  });

  it("always styles the canvas at exactly backing size over the ratio", () => {
    for (const scale of [1, 1.25, 1.5, 1.75, 2, 2.25, 3]) {
      const canvas = fakeCanvas(300, 150);
      const backing = new CanvasBackingStore(canvas);
      // First presentation: exact, no surplus.
      backing.stage(1111, 777, scale);
      backing.commit();
      expect(canvas.width).toBe(1111);
      expect(Number.parseFloat(canvas.style.width) * scale).toBeCloseTo(
        canvas.width,
        6,
      );
      // After presenting, nearby sizes reuse the surplus but stay 1:1.
      backing.stage(1100, 770, scale);
      backing.commit();
      expect(Number.parseFloat(canvas.style.width) * scale).toBeCloseTo(
        canvas.width,
        6,
      );
      expect(Number.parseFloat(canvas.style.height) * scale).toBeCloseTo(
        canvas.height,
        6,
      );
    }
  });

  it("reallocates the swapchain only every few device pixels during a drag resize", () => {
    const canvas = fakeCanvas(300, 150);
    const backing = new CanvasBackingStore(canvas);
    backing.stage(1000, 600, 1.5);
    backing.commit();
    let allocations = 0;
    let previousWidth = canvas.width;
    for (let width = 1000; width <= 1400; width += 3) {
      backing.stage(width, 600, 1.5);
      backing.commit();
      if (canvas.width !== previousWidth) allocations += 1;
      previousWidth = canvas.width;
      expect(canvas.width).toBeGreaterThanOrEqual(width);
    }
    const steps = Math.floor(400 / 3) + 1;
    expect(allocations).toBeLessThan(steps / 10);
  });

  describe("during a resize gesture", () => {
    function presented(width: number, height: number, scale = 2) {
      const canvas = fakeCanvas(300, 150);
      const backing = new CanvasBackingStore(canvas);
      backing.stage(width, height, scale);
      backing.commit();
      return { canvas, backing };
    }

    it("keeps the backing, and the exact 1:1 CSS size, while the window shrinks", () => {
      const { canvas, backing } = presented(3000, 2000);
      const growth = vi.fn(() => ({ width: 5000, height: 3000 }));
      let allocations = 0;
      for (let width = 3000; width >= 800; width -= 8) {
        const before = canvas.width;
        backing.stage(width, Math.round(width * 0.66), 2, growth);
        backing.commit();
        if (canvas.width !== before) allocations += 1;
      }
      expect(allocations).toBe(0);
      expect(canvas).toMatchObject({
        width: 3000,
        height: 2000,
        style: { width: "1500px", height: "1000px" },
      });
      // Nothing to grow, so nothing is measured.
      expect(growth).not.toHaveBeenCalled();
    });

    it("allocates once, to the bound, when the window outgrows the backing", () => {
      const { canvas, backing } = presented(1000, 700);
      const growth = vi.fn(() => ({ width: 3456, height: 2234 }));
      let allocations = 0;
      for (let width = 1000; width <= 3400; width += 8) {
        const before = canvas.width;
        backing.stage(width, Math.round(width * 0.62), 2, growth);
        backing.commit();
        if (canvas.width !== before) allocations += 1;
        expect(canvas.width).toBeGreaterThanOrEqual(width);
      }
      expect(allocations).toBe(1);
      expect(canvas).toMatchObject({ width: 3456 });
      expect(canvas.style.width).toBe("1728px");
      expect(Number.parseFloat(canvas.style.width) * 2).toBe(canvas.width);
    });

    it("grows both axes together, so the other one cannot cost a second allocation", () => {
      const { canvas, backing } = presented(2000, 1400);
      backing.stage(2200, 1000, 2, () => ({ width: 3000, height: 2600 }));
      backing.commit();
      expect(canvas).toMatchObject({ width: 3000, height: 2600 });
    });

    it("never allocates less than what is required, whatever the bound says", () => {
      const { canvas, backing } = presented(1000, 700);
      backing.stage(2400, 600, 2, () => ({ width: 100, height: 100 }));
      backing.commit();
      // Never smaller than it was, either.
      expect(canvas).toMatchObject({ width: 2400, height: 700 });
    });

    it("compacts to the usual nearby size with the first stage after the gesture", () => {
      const { canvas, backing } = presented(1000, 700);
      backing.stage(3000, 2000, 2, () => ({ width: 3456, height: 2234 }));
      backing.commit();
      expect(canvas.width).toBe(3456);

      backing.stage(1010, 706, 2);
      backing.commit();

      expect(canvas).toMatchObject({ width: 1024, height: 768 });
      expect(canvas.style.width).toBe("512px");
    });

    it("leaves a backing that is only slightly large alone when the gesture ends", () => {
      const { canvas, backing } = presented(1000, 700);
      backing.stage(900, 650, 2, () => ({ width: 5000, height: 5000 }));
      expect(backing.stage(900, 650, 2)).toBe(false);
      backing.commit();
      expect(canvas).toMatchObject({ width: 1000, height: 700 });
    });

    it("sizes a store that has not presented yet exactly", () => {
      const canvas = fakeCanvas(300, 150);
      const backing = new CanvasBackingStore(canvas);
      backing.stage(900, 500, 2, () => ({ width: 5000, height: 5000 }));
      backing.commit();
      expect(canvas).toMatchObject({ width: 900, height: 500 });
    });
  });
});
