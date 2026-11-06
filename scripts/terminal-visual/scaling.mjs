// Compare the browser-composited pixels with the untouched renderer texture. A texture-only
// comparison cannot catch canvas resampling by CSS layout/transforms.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { createServer } from "vite";

const out = process.env.TERAX_VISUAL_OUT ?? await fs.mkdtemp(path.join(os.tmpdir(), "terax-scaling-"));
process.env.TERAX_VISUAL_OUT = out;
const server = await createServer({
  configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
  server: { host: "127.0.0.1", port: 0 },
});
const reports = [];
const failures = [];
const origins = [{ x: 11, y: 21 }, { x: 10.25, y: 20.25 }];

function compare(a, b, width, height, ax = 0, ay = 0) {
  assert.ok(width > 0 && height > 0 && Number.isInteger(width) && Number.isInteger(height));
  assert.ok(ax >= 0 && ay >= 0 && ax + width <= a.width && ay + height <= a.height);
  assert.ok(width <= b.width && height <= b.height, "both images must cover the compared region");
  let different = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let inkPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (b.data[(y * b.width + x) * 4 + 1] > 100) inkPixels++;
    let delta = 0;
    for (let c = 0; c < 3; c++) {
      delta = Math.max(delta, Math.abs(a.data[((y + ay) * a.width + x + ax) * 4 + c] - b.data[(y * b.width + x) * 4 + c]));
    }
    if (delta > 1) different++;
    maxDelta = Math.max(maxDelta, delta);
    sumDelta += delta;
  }
  assert.ok(inkPixels > 100, "the compared region must contain glyph ink, not only the background");
  return { pixels: width * height, different, maxDelta, meanDelta: +(sumDelta / (width * height)).toFixed(5) };
}

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const dpr of [1, 1.25, 1.5, 2]) {
    // deviceScaleFactor alone emulates DPR but leaves native device-pixel boxes at DPR 1.
    // Set Chromium's real scale too, as on a Windows display with 125%/150% scaling.
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH,
      channel: process.env.CHROME_CHANNEL ?? "chromium",
      args: ["--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--force-color-profile=srgb", `--force-device-scale-factor=${dpr}`, ...(process.platform === "linux" ? ["--use-angle=swiftshader", "--use-webgpu-adapter=swiftshader"] : [])],
    });
    // Also bounds page.evaluate if device loss prevents the pending texture readback.
    const deadline = setTimeout(() => void browser.close(), 60_000);
    try {
      const references = [];
      for (const renderer of ["webgl", "webgpu"]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: dpr });
        const pageErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") console.error(message.text());
        });
        page.on("pageerror", (error) => {
          pageErrors.push(error.message);
          console.error(error);
        });
        await page.goto(`${url}/?renderer=${renderer}&pattern=empty&w=1001&h=641&aw=1001&ah=641`);
        await page.waitForFunction(() => !!window.harness);
        for (const [index, origin] of origins.entries()) {
          await page.evaluate(async ({ x, y }) => {
            const area = document.querySelector("#stage");
            area.style.left = `${x}px`;
            area.style.top = `${y}px`;
            document.querySelector("#info").style.display = "none";
            window.dispatchEvent(new Event("resize"));
            const lines = Array.from({ length: 20 }, (_, i) => `HIl|1 M W 0123456789 The quick brown fox ─│┌┐ █▌▐ ${i}`);
            window.harness.write("\x1b[2J\x1b[H\x1b[?25l" + lines.join("\r\n"));
            await window.harness.settle();
          }, origin);
          const stats = await page.evaluate(() => window.harness.diagnostics());
          assert.ok(stats.frames > 0, `renderer did not present: ${JSON.stringify(stats)}`);
          const name = `${renderer}-${dpr}-${index}`;
          const meta = await page.evaluate((name) => window.harness.capture(name), name);
          const geometry = await page.evaluate(async () => {
            const canvas = document.querySelector("canvas");
            const box = await new Promise((resolve) => {
              const observer = new ResizeObserver(([entry]) => {
                observer.disconnect();
                const size = entry.devicePixelContentBoxSize?.[0];
                resolve(size && { width: size.inlineSize, height: size.blockSize });
              });
              observer.observe(canvas);
            });
            return { backing: { width: canvas.width, height: canvas.height }, devicePixelContentBoxSize: box };
          });
          assert.deepEqual(geometry.devicePixelContentBoxSize, geometry.backing, "native device-pixel box must equal the backing (DPR emulation alone is insufficient)");
          const raw = { width: meta.width, height: meta.height, data: await fs.readFile(path.join(out, `${name}.rgba`)) };
          assert.equal(raw.data.length, raw.width * raw.height * 4, "complete RGBA readback");
          const shot = await page.screenshot({ path: path.join(out, `${name}.png`) });
          const screen = PNG.sync.read(shot);
          assert.equal(screen.width, 1100 * dpr, "screenshot must contain physical pixels");
          const width = Math.min(meta.width, Math.round(950 * dpr));
          const height = Math.min(meta.height, Math.round(600 * dpr));
          const composed = compare(screen, raw, width, height, Math.round(origin.x * dpr), Math.round(origin.y * dpr));
          const parity = renderer === "webgpu" ? compare(raw, references[index], width, height) : null;
          if (renderer === "webgl") references[index] = raw;
          const report = { dpr, renderer, origin, composed, parity };
          reports.push(report);
          console.log(JSON.stringify(report));
          if (composed.different || parity?.different) failures.push(name);
        }
        assert.deepEqual(pageErrors, [], "browser errors");
        await page.close();
      }
    } finally {
      clearTimeout(deadline);
      await browser.close();
    }
  }
  await fs.writeFile(path.join(out, "scaling.json"), JSON.stringify(reports, null, 2));
  assert.deepEqual(failures, [], `composited pixel regression; captures: ${out}`);
  console.log(`SCALING CHECK PASSED; captures: ${out}`);
} finally {
  await server.close();
}
