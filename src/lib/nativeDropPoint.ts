type Point = { x: number; y: number };

// Wry 0.57 forwards WebView2 client pixels, but Cocoa and GTK widget points.
// Tauri wraps both in PhysicalPosition without converting them.
export function nativeDropClientPoint(
  position: Point,
  isWindows: boolean,
  pixelRatio: number,
): Point {
  if (
    !isWindows ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio <= 0 ||
    pixelRatio === 1
  )
    return position;
  return { x: position.x / pixelRatio, y: position.y / pixelRatio };
}
