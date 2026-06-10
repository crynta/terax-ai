const DIFF_THRESHOLD = 30; // per-channel Euclidean distance threshold
const DIFF_HIGHLIGHT = [239, 68, 68, 180]; // red-500 at ~70% opacity

export type CaptureResult =
  | { status: "ok"; dataUrl: string; width: number; height: number }
  | { status: "error"; message: string };

/**
 * Capture an iframe element's visual content to a data URL.
 * Only works for same-origin iframes (srcDoc, localhost, etc).
 */
export function captureIframeScreenshot(
  iframe: HTMLIFrameElement,
): CaptureResult {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    return {
      status: "error",
      message: "Cannot access iframe content (cross-origin or not loaded).",
    };
  }

  const w = doc.documentElement.scrollWidth || win.innerWidth;
  const h = doc.documentElement.scrollHeight || win.innerHeight;
  if (w === 0 || h === 0) {
    return { status: "error", message: "Iframe has no visible content." };
  }

  // Clamp to reasonable bounds
  const maxDim = 4096;
  const cw = Math.min(w, maxDim);
  const ch = Math.min(h, maxDim);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { status: "error", message: "Canvas 2D context unavailable." };
  }

  try {
    ctx.drawImage(iframe as unknown as CanvasImageSource, 0, 0, cw, ch);
  } catch {
    return {
      status: "error",
      message: "Cannot draw iframe (cross-origin restriction).",
    };
  }

  // Verify we actually got pixels — drawImage on cross-origin silently fails
  const sample = ctx.getImageData(0, 0, 1, 1).data;
  if (sample[3] === 0) {
    return {
      status: "error",
      message: "Screenshot appears blank (cross-origin or empty content).",
    };
  }

  return { status: "ok", dataUrl: canvas.toDataURL("image/png"), width: cw, height: ch };
}

export type PixelDiffResult = {
  diffDataUrl: string;
  width: number;
  height: number;
  mismatchedPixels: number;
  totalPixels: number;
  mismatchPercent: number;
};

/**
 * Compare two screenshot data URLs pixel-by-pixel.
 * Returns a diff image with mismatched pixels highlighted in red.
 */
export function pixelDiff(
  imageA: string,
  imageB: string,
): Promise<PixelDiffResult> {
  return new Promise((resolve, reject) => {
    const imgA = new Image();
    const imgB = new Image();
    let loaded = 0;

    const onLoad = () => {
      loaded += 1;
      if (loaded < 2) return;

      const w = Math.max(imgA.naturalWidth, imgB.naturalWidth);
      const h = Math.max(imgA.naturalHeight, imgB.naturalHeight);

      const canvasA = document.createElement("canvas");
      canvasA.width = w;
      canvasA.height = h;
      const ctxA = canvasA.getContext("2d")!;
      ctxA.fillStyle = "#ffffff";
      ctxA.fillRect(0, 0, w, h);
      ctxA.drawImage(imgA, 0, 0);

      const canvasB = document.createElement("canvas");
      canvasB.width = w;
      canvasB.height = h;
      const ctxB = canvasB.getContext("2d")!;
      ctxB.fillStyle = "#ffffff";
      ctxB.fillRect(0, 0, w, h);
      ctxB.drawImage(imgB, 0, 0);

      const dataA = ctxA.getImageData(0, 0, w, h);
      const dataB = ctxB.getImageData(0, 0, w, h);

      const diffCanvas = document.createElement("canvas");
      diffCanvas.width = w;
      diffCanvas.height = h;
      const diffCtx = diffCanvas.getContext("2d")!;
      const diffData = diffCtx.createImageData(w, h);

      let mismatched = 0;
      const total = w * h;

      for (let i = 0; i < total; i += 1) {
        const offset = i * 4;
        const rA = dataA.data[offset];
        const gA = dataA.data[offset + 1];
        const bA = dataA.data[offset + 2];
        const rB = dataB.data[offset];
        const gB = dataB.data[offset + 1];
        const bB = dataB.data[offset + 2];

        const distance = Math.sqrt(
          (rA - rB) ** 2 + (gA - gB) ** 2 + (bA - bB) ** 2,
        );

        if (distance > DIFF_THRESHOLD) {
          mismatched += 1;
          diffData.data[offset] = DIFF_HIGHLIGHT[0];
          diffData.data[offset + 1] = DIFF_HIGHLIGHT[1];
          diffData.data[offset + 2] = DIFF_HIGHLIGHT[2];
          diffData.data[offset + 3] = DIFF_HIGHLIGHT[3];
        } else {
          // Dim the matching areas to make differences pop
          diffData.data[offset] = Math.round(dataA.data[offset] * 0.4);
          diffData.data[offset + 1] = Math.round(dataA.data[offset + 1] * 0.4);
          diffData.data[offset + 2] = Math.round(dataA.data[offset + 2] * 0.4);
          diffData.data[offset + 3] = 255;
        }
      }

      diffCtx.putImageData(diffData, 0, 0);

      resolve({
        diffDataUrl: diffCanvas.toDataURL("image/png"),
        width: w,
        height: h,
        mismatchedPixels: mismatched,
        totalPixels: total,
        mismatchPercent: total > 0 ? Math.round((mismatched / total) * 10000) / 100 : 0,
      });
    };

    const onError = () => reject(new Error("Failed to load screenshot image."));

    imgA.onload = onLoad;
    imgA.onerror = onError;
    imgB.onload = onLoad;
    imgB.onerror = onError;

    imgA.src = imageA;
    imgB.src = imageB;
  });
}

export function formatMismatchPercent(percent: number): string {
  if (percent < 0.01) return "0.00%";
  return `${percent.toFixed(2)}%`;
}
