// Offline pixel tools for harness captures (raw RGBA + JSON sidecar).
//   node compare.mjs diff <dir> <a> <b> [out.png]     per-pixel diff of two captures
//   node compare.mjs png <dir> <name> [scale] [x y w h] export one capture (optionally cropped, upscaled)
//   node compare.mjs crisp <dir> <name>               edge sharpness / fractional-edge statistics
//   node compare.mjs grid <dir> <split> <single>      split-pane capture (grid.html) against one pane of the same size
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [command, dir, ...rest] = process.argv.slice(2);

function load(name) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
  const rgba = fs.readFileSync(path.join(dir, `${name}.rgba`));
  return { meta, rgba, width: meta.width, height: meta.height };
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function writePng(file, width, height, rgba) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function crop(image, x, y, w, h, scale) {
  const out = Buffer.alloc(w * scale * h * scale * 4);
  for (let oy = 0; oy < h * scale; oy += 1) {
    for (let ox = 0; ox < w * scale; ox += 1) {
      const from = ((y + Math.floor(oy / scale)) * image.width + x + Math.floor(ox / scale)) * 4;
      image.rgba.copy(out, (oy * w * scale + ox) * 4, from, from + 4);
    }
  }
  return { width: w * scale, height: h * scale, rgba: out };
}

if (command === "png") {
  const [name, scaleText = "1", ...box] = rest;
  const image = load(name);
  const scale = Number(scaleText);
  const [x, y, w, h] = box.length === 4 ? box.map(Number) : [0, 0, image.width, image.height];
  const out = crop(image, x, y, w, h, scale);
  const file = path.join(dir, `${name}${box.length ? "-crop" : ""}.png`);
  writePng(file, out.width, out.height, out.rgba);
  console.log(file);
} else if (command === "diff") {
  const [aName, bName, outName] = rest;
  const a = load(aName);
  const b = load(bName);
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    process.exit(1);
  }
  const out = Buffer.alloc(a.rgba.length);
  let different = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  const histogram = new Array(8).fill(0);
  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta = Math.max(delta, Math.abs(a.rgba[pixel * 4 + channel] - b.rgba[pixel * 4 + channel]));
    }
    if (delta > 0) different += 1;
    maxDelta = Math.max(maxDelta, delta);
    sumDelta += delta;
    histogram[Math.min(7, Math.ceil(Math.log2(delta + 1)))] += 1;
    const level = Math.min(255, delta * 8);
    out[pixel * 4] = level;
    out[pixel * 4 + 1] = delta > 0 ? 40 : 0;
    out[pixel * 4 + 2] = delta > 0 ? 80 : 0;
    out[pixel * 4 + 3] = 255;
  }
  const total = a.width * a.height;
  console.log(
    JSON.stringify({
      pixels: total,
      different,
      differentPercent: +((different / total) * 100).toFixed(4),
      maxDelta,
      meanDelta: +(sumDelta / total).toFixed(5),
      deltaHistogramLog2: histogram,
    }),
  );
  if (outName) writePng(path.join(dir, outName), a.width, a.height, out);
} else if (command === "crisp") {
  // Fraction of horizontal glyph-edge transitions that land on a single pixel
  // step (crisp) versus smeared over several partially covered pixels.
  const [name] = rest;
  const image = load(name);
  let steps = 0;
  let partial = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 1; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const j = i - 4;
      const g1 = image.rgba[i + 1];
      const g0 = image.rgba[j + 1];
      if (Math.abs(g1 - g0) > 24) {
        steps += 1;
        const next = x + 1 < image.width ? image.rgba[i + 5] : g1;
        if (Math.abs(next - g1) > 24) partial += 1;
      }
    }
  }
  console.log(JSON.stringify({ steps, multiPixelRamps: partial }));
} else if (command === "grid") {
  // Every pane's rectangle (its grid area when the rectangle's size differs from the reference's by
  // a pixel of rounding) must equal the single-pane capture byte for byte; everything outside the
  // panes' rectangles (dividers, gaps) must be the clear colour, so nothing bleeds across a
  // scissor edge; panes and dividers must abut exactly.
  const [splitName, singleName] = rest;
  const split = load(splitName);
  const single = load(singleName);
  const reference = single.meta.panes[0];
  const cellW = split.meta.cell.width;
  const cellH = split.meta.cell.height;
  const [cr, cg, cb] = split.meta.clear;
  const covered = new Uint8Array(split.width * split.height);
  const report = { panes: [], outsideNotClear: 0, abutting: [], referenceSize: `${reference.cols}x${reference.rows}` };
  const referenceWidth = reference.cols * cellW;
  const referenceHeight = reference.rows * cellH;
  const same = (a, b, ax, ay, bx, by) =>
    split.rgba[(ay * split.width + ax) * 4] === single.rgba[(by * single.width + bx) * 4] &&
    split.rgba[(ay * split.width + ax) * 4 + 1] === single.rgba[(by * single.width + bx) * 4 + 1] &&
    split.rgba[(ay * split.width + ax) * 4 + 2] === single.rgba[(by * single.width + bx) * 4 + 2];
  for (const [index, pane] of split.meta.panes.entries()) {
    const { x, y } = pane.viewport;
    const width = pane.cols * cellW;
    const height = pane.rows * cellH;
    let differing = 0;
    if (width !== referenceWidth || height !== referenceHeight) {
      report.panes.push({ index, sizeMismatch: `${pane.cols}x${pane.rows}` });
      continue;
    }
    // The grid area, and the whole rectangle (slack included: glyph overhang past the last
    // column lands there) where it has the reference's size.
    const full = pane.viewport.width === reference.viewport.width && pane.viewport.height === reference.viewport.height;
    const compareWidth = full ? pane.viewport.width : width;
    const compareHeight = full ? pane.viewport.height : height;
    for (let row = 0; row < compareHeight; row += 1) {
      for (let col = 0; col < compareWidth; col += 1) {
        if (!same(0, 0, x + col, y + row, col, row)) differing += 1;
      }
    }
    const v = pane.viewport;
    const h = pane.host;
    report.panes.push({
      index,
      rect: v,
      grid: `${width}x${height}`,
      compared: full ? "rectangle" : "grid area",
      differingPixels: differing,
      // The canvas rectangle is the DOM box, snapped the way the engine snaps it.
      viewportIsHostBox: v.x === h.x && v.y === h.y && v.width === h.width && v.height === h.height,
    });
    for (let row = 0; row < v.height; row += 1) for (let col = 0; col < v.width; col += 1) covered[(v.y + row) * split.width + v.x + col] = 1;
  }
  for (let pixel = 0; pixel < split.width * split.height; pixel += 1) {
    if (covered[pixel]) continue;
    if (
      split.rgba[pixel * 4] !== cr ||
      split.rgba[pixel * 4 + 1] !== cg ||
      split.rgba[pixel * 4 + 2] !== cb
    )
      report.outsideNotClear += 1;
  }
  // Panes and the dividers between them must meet edge to edge.
  for (const divider of split.meta.dividers) {
    const vertical = divider.height > divider.width;
    const before = split.meta.panes
      .map((p) => p.host)
      .filter((h) => (vertical ? h.x + h.width === divider.x && h.y < divider.y + divider.height && h.y + h.height > divider.y : h.y + h.height === divider.y && h.x < divider.x + divider.width && h.x + h.width > divider.x));
    const after = split.meta.panes
      .map((p) => p.host)
      .filter((h) => (vertical ? h.x === divider.x + divider.width && h.y < divider.y + divider.height && h.y + h.height > divider.y : h.y === divider.y + divider.height && h.x < divider.x + divider.width && h.x + h.width > divider.x));
    report.abutting.push({ divider, before: before.length, after: after.length });
  }
  const bad =
    report.panes.some((p) => p.sizeMismatch || p.differingPixels > 0 || p.viewportIsHostBox === false) ||
    report.outsideNotClear > 0 ||
    report.abutting.some((d) => d.before === 0 || d.after === 0);
  console.log(JSON.stringify(report, null, 1));
  console.log(bad ? "GRID CHECK FAILED" : "GRID CHECK PASSED");
  process.exit(bad ? 1 : 0);
} else {
  console.error("usage: compare.mjs diff|png|crisp|grid <dir> ...");
  process.exit(2);
}
