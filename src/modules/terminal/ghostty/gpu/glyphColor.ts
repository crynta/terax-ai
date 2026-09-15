export function hasIntrinsicColor(rgba: Uint8ClampedArray): boolean {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] < 16) continue;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    if (
      Math.abs(red - green) > 8 ||
      Math.abs(red - blue) > 8 ||
      Math.abs(green - blue) > 8 ||
      Math.abs(255 - red) > 8
    ) {
      return true;
    }
  }
  return false;
}
