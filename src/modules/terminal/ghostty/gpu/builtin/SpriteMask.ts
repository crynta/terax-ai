/**
 * A coverage mask the size of one terminal cell, with just enough 2D
 * primitives to draw box-drawing, block, braille and powerline glyphs.
 *
 * Axis-aligned rectangles overwrite whole pixels, so they are exact and never
 * bleed into a neighbour. Polygons (diagonals, arcs, triangles) are filled with
 * exact area coverage and composited source-over, which keeps their edges
 * smooth without a canvas, a DOM or any platform rasterizer: the same bytes
 * come out in a test, in the WebGPU atlas and in the WebGL atlas.
 */

type Ring = readonly number[];

const MITER_LIMIT = 10;

export class SpriteMask {
  readonly data: Uint8Array;
  /** Signed-area accumulation buffer: one spare column for edges at x = width. */
  private readonly accumulation: Float64Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
    this.accumulation = new Float64Array((width + 2) * height);
  }

  get byteSize(): number {
    return this.data.byteLength + this.accumulation.byteLength;
  }

  clear(): void {
    this.data.fill(0);
  }

  /** Overwrites `[x0, x1) x [y0, y1)` (clipped to the cell) with `value`. */
  box(x0: number, y0: number, x1: number, y1: number, value = 255): void {
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(this.width, Math.max(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const bottom = Math.min(this.height, Math.max(y0, y1));
    for (let y = top; y < bottom; y += 1) {
      this.data.fill(value, y * this.width + left, y * this.width + right);
    }
  }

  /** Mirrors the mask left to right. */
  flipHorizontal(): void {
    const { data, width } = this;
    for (let y = 0; y < this.height; y += 1) {
      data.subarray(y * width, (y + 1) * width).reverse();
    }
  }

  /** Replaces every pixel with its complement. */
  invert(): void {
    const data = this.data;
    for (let index = 0; index < data.length; index += 1) {
      data[index] = 255 - data[index];
    }
  }

  /**
   * Fills a polygon, optionally with holes, with exact area coverage scaled by
   * `value` and composited over what is already there.
   */
  fill(outer: Ring, holes: readonly Ring[] = [], value = 255): void {
    if (outer.length < 6) return;
    const accumulation = this.accumulation;
    accumulation.fill(0);
    let touched = this.addRing(outer, 1);
    for (const hole of holes) touched = this.addRing(hole, -1) || touched;
    if (!touched) return;

    const stride = this.width + 2;
    const data = this.data;
    for (let y = 0; y < this.height; y += 1) {
      let sum = 0;
      for (let x = 0; x < this.width; x += 1) {
        sum += accumulation[y * stride + x];
        const coverage = Math.min(1, Math.abs(sum));
        if (coverage < 1 / 512) continue;
        const index = y * this.width + x;
        const below = data[index];
        data[index] = Math.round(below + coverage * value * (1 - below / 255));
      }
    }
  }

  /**
   * Fills a closed outline of the given weight lying inside `ring`; a shape too
   * small to have an inside is filled solid.
   */
  outline(ring: Ring, thickness: number): void {
    const inner = insetRing(ring, thickness);
    this.fill(ring, inner ? [inner] : []);
  }

  /** Strokes a line segment with butt caps. */
  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
  ): void {
    this.stroke([x0, y0, x1, y1], thickness);
  }

  /**
   * Strokes an open polyline with butt caps and miter joins. `inset` shifts the
   * stroke sideways by that distance (positive is to the right of the travel
   * direction in a y-down coordinate system), so a band can sit inside a shape.
   */
  stroke(points: Ring, thickness: number, inset = 0): void {
    const ring = strokeOutline(points, thickness, inset);
    if (ring) this.fill(ring);
  }

  private addRing(points: Ring, sign: 1 | -1): boolean {
    const clipped = clipToRectangle(points, this.width, this.height);
    if (clipped.length < 6) return false;
    // Rings are oriented so the outer boundary adds area and holes subtract.
    const forward = signedArea(clipped) >= 0 ? 1 : -1;
    const count = clipped.length / 2;
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const x0 = clipped[index * 2];
      const y0 = clipped[index * 2 + 1];
      const x1 = clipped[next * 2];
      const y1 = clipped[next * 2 + 1];
      if (sign * forward > 0) this.edge(x0, y0, x1, y1);
      else this.edge(x1, y1, x0, y0);
    }
    return true;
  }

  /** Accumulates one edge of a polygon (after font-rs' signed-area scheme). */
  private edge(startX: number, startY: number, endX: number, endY: number) {
    if (startY === endY) return;
    let x0 = startX;
    let y0 = startY;
    let x1 = endX;
    let y1 = endY;
    let direction = 1;
    if (y0 > y1) {
      [x0, y0, x1, y1] = [x1, y1, x0, y0];
      direction = -1;
    }
    const slope = (x1 - x0) / (y1 - y0);
    const stride = this.width + 2;
    const accumulation = this.accumulation;
    let x = x0;
    const last = Math.min(this.height, Math.ceil(y1));
    for (let y = Math.max(0, Math.floor(y0)); y < last; y += 1) {
      const row = y * stride;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const nextX = x + slope * dy;
      const d = dy * direction;
      const low = Math.min(x, nextX);
      const high = Math.max(x, nextX);
      const lowFloor = Math.floor(low);
      const lowIndex = lowFloor;
      const highIndex = Math.ceil(high);
      if (highIndex <= lowIndex + 1) {
        const mid = 0.5 * (x + nextX) - lowFloor;
        accumulation[row + lowIndex] += d - d * mid;
        accumulation[row + lowIndex + 1] += d * mid;
      } else {
        const inverse = 1 / (high - low);
        const lowFraction = low - lowFloor;
        const first = 0.5 * inverse * (1 - lowFraction) * (1 - lowFraction);
        const highFraction = high - highIndex + 1;
        const lastArea = 0.5 * inverse * highFraction * highFraction;
        accumulation[row + lowIndex] += d * first;
        if (highIndex === lowIndex + 2) {
          accumulation[row + lowIndex + 1] += d * (1 - first - lastArea);
        } else {
          const second = inverse * (1.5 - lowFraction);
          accumulation[row + lowIndex + 1] += d * (second - first);
          for (let column = lowIndex + 2; column < highIndex - 1; column += 1) {
            accumulation[row + column] += d * inverse;
          }
          const third = second + (highIndex - lowIndex - 3) * inverse;
          accumulation[row + highIndex - 1] += d * (1 - third - lastArea);
        }
        accumulation[row + highIndex] += d * lastArea;
      }
      x = nextX;
    }
  }
}

function signedArea(points: Ring): number {
  let area = 0;
  const count = points.length / 2;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    area +=
      points[index * 2] * points[next * 2 + 1] -
      points[next * 2] * points[index * 2 + 1];
  }
  return area / 2;
}

/** Sutherland-Hodgman against `[0, width] x [0, height]`; keeps areas exact. */
function clipToRectangle(points: Ring, width: number, height: number): Ring {
  let ring: number[] = Array.from(points);
  const planes: ReadonlyArray<readonly [number, number, number]> = [
    // [axis (0 = x, 1 = y), sign, limit]: keep where sign * (v - limit) >= 0
    [0, 1, 0],
    [0, -1, width],
    [1, 1, 0],
    [1, -1, height],
  ];
  for (const [axis, sign, limit] of planes) {
    if (ring.length < 6) return [];
    const next: number[] = [];
    const count = ring.length / 2;
    for (let index = 0; index < count; index += 1) {
      const current = index;
      const previous = (index + count - 1) % count;
      const cx = ring[current * 2];
      const cy = ring[current * 2 + 1];
      const px = ring[previous * 2];
      const py = ring[previous * 2 + 1];
      const currentValue = (axis === 0 ? cx : cy) - limit;
      const previousValue = (axis === 0 ? px : py) - limit;
      const currentInside = sign * currentValue >= 0;
      const previousInside = sign * previousValue >= 0;
      if (currentInside !== previousInside) {
        const t = previousValue / (previousValue - currentValue);
        next.push(px + (cx - px) * t, py + (cy - py) * t);
      }
      if (currentInside) next.push(cx, cy);
    }
    ring = next;
  }
  return ring;
}

/**
 * The outline of a stroked polyline as one polygon: the left side forward then
 * the right side back, with a miter at each interior vertex (bevel past the
 * limit) and square (butt) ends.
 */
function strokeOutline(
  points: Ring,
  thickness: number,
  inset = 0,
): number[] | null {
  const vertices: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const count = vertices.length;
    if (
      count >= 2 &&
      vertices[count - 2] === points[index] &&
      vertices[count - 1] === points[index + 1]
    ) {
      continue;
    }
    vertices.push(points[index], points[index + 1]);
  }
  const count = vertices.length / 2;
  if (count < 2 || thickness <= 0) return null;

  // Unit normals of each segment (left of travel in y-down coordinates).
  const normals: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = vertices[index * 2 + 2] - vertices[index * 2];
    const dy = vertices[index * 2 + 3] - vertices[index * 2 + 1];
    const length = Math.hypot(dx, dy);
    normals.push(dy / length, -dx / length);
  }

  const half = thickness / 2;
  // Signed distances along the left normal of the two boundaries.
  const leftOffset = half - inset;
  const rightOffset = -(half + inset);
  const left: number[] = [];
  const right: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = vertices[index * 2];
    const y = vertices[index * 2 + 1];
    // At the two ends both normals are the end segment's own.
    const before = Math.max(0, index - 1) * 2;
    const after = Math.min(count - 2, index) * 2;
    const n0x = normals[before];
    const n0y = normals[before + 1];
    const n1x = normals[after];
    const n1y = normals[after + 1];
    const dot = n0x * n1x + n0y * n1y;
    const miter = 1 / Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
    if (miter <= MITER_LIMIT) {
      const sx = n0x + n1x;
      const sy = n0y + n1y;
      left.push(
        x + (sx * leftOffset) / (1 + dot),
        y + (sy * leftOffset) / (1 + dot),
      );
      right.push(
        x + (sx * rightOffset) / (1 + dot),
        y + (sy * rightOffset) / (1 + dot),
      );
    } else {
      left.push(
        x + n0x * leftOffset,
        y + n0y * leftOffset,
        x + n1x * leftOffset,
        y + n1y * leftOffset,
      );
      right.push(
        x + n0x * rightOffset,
        y + n0y * rightOffset,
        x + n1x * rightOffset,
        y + n1y * rightOffset,
      );
    }
  }
  const outline = left;
  for (let index = right.length - 2; index >= 0; index -= 2) {
    outline.push(right[index], right[index + 1]);
  }
  return outline;
}

/**
 * `ring` moved inward by `distance` with mitered corners (exact for convex
 * shapes); null when the inset turns it inside out.
 */
function insetRing(ring: Ring, distance: number): number[] | null {
  const count = ring.length / 2;
  if (count < 3) return null;
  // With a y-down axis a positive area means the interior is right of travel.
  const side = signedArea(ring) >= 0 ? 1 : -1;
  const normals: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const dx = ring[next * 2] - ring[index * 2];
    const dy = ring[next * 2 + 1] - ring[index * 2 + 1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    normals.push((-dy * side) / length, (dx * side) / length);
  }
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = ((index + count - 1) % count) * 2;
    const after = index * 2;
    const dot =
      normals[before] * normals[after] +
      normals[before + 1] * normals[after + 1];
    const scale = distance / (1 + dot);
    result.push(
      ring[index * 2] + (normals[before] + normals[after]) * scale,
      ring[index * 2 + 1] + (normals[before + 1] + normals[after + 1]) * scale,
    );
  }
  // A collapsed inset has turned inside out: some edge now runs backwards.
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const before =
      (ring[next * 2] - ring[index * 2]) *
        (result[next * 2] - result[index * 2]) +
      (ring[next * 2 + 1] - ring[index * 2 + 1]) *
        (result[next * 2 + 1] - result[index * 2 + 1]);
    if (before <= 0) return null;
  }
  return result;
}

/** Appends the flattened cubic Bezier (without its start point) to `out`. */
export function flattenCubic(
  out: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  segments: number,
): void {
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(
      a * x0 + b * x1 + c * x2 + d * x3,
      a * y0 + b * y1 + c * y2 + d * y3,
    );
  }
}
