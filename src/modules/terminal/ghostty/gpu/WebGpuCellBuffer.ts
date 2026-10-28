/** Bytes of one cell record (`GPU_CELL_BYTES` in the Ghostty bridge). */
export const CELL_RECORD_BYTES = 16;
export const MAX_WEBGPU_SURFACE_CELLS = 262_144;

const CAPACITY_ALIGNMENT = 256;
const MIN_CELL_CAPACITY = 1_024;
const COMPACTION_RATIO = 2;
const MIN_COMPACTION_SAVINGS = 4_096;

export function nextWebGpuCellCapacity(
  current: number,
  required: number,
): number {
  if (!Number.isInteger(required) || required < 0) {
    throw new RangeError("WebGPU cell capacity must be a non-negative integer");
  }
  if (required > MAX_WEBGPU_SURFACE_CELLS) {
    throw new RangeError(
      `Terminal surface exceeds ${MAX_WEBGPU_SURFACE_CELLS} cells`,
    );
  }
  if (required <= current) return current;
  const target =
    current > 0
      ? Math.max(required, Math.ceil(current * 1.5))
      : Math.max(MIN_CELL_CAPACITY, Math.ceil(required * 1.125));
  return Math.min(
    MAX_WEBGPU_SURFACE_CELLS,
    Math.ceil(target / CAPACITY_ALIGNMENT) * CAPACITY_ALIGNMENT,
  );
}

/**
 * Returns a smaller capacity only after a large transient viewport has left
 * enough unused space to justify recreating the GPU buffer.
 */
export function compactWebGpuCellCapacity(
  current: number,
  required: number,
): number | null {
  if (!Number.isInteger(current) || current < 0) {
    throw new RangeError("WebGPU cell capacity must be a non-negative integer");
  }
  const target = nextWebGpuCellCapacity(0, required);
  if (
    current < target * COMPACTION_RATIO ||
    current - target < MIN_COMPACTION_SAVINGS
  ) {
    return null;
  }
  return target;
}

/** Copies a per-cell search mask into `scratch`, padded to whole u32 words. */
export function packSearchMask(
  mask: Uint8Array,
  scratch: Uint8Array,
): Uint8Array {
  const length = Math.max(4, Math.ceil(mask.length / 4) * 4);
  const target = scratch.length >= length ? scratch : new Uint8Array(length);
  target.fill(0, 0, length);
  target.set(mask);
  return target.subarray(0, length);
}
