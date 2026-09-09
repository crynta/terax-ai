import type {
  TypedArray,
  TypedArrayConstructor,
  ViewCacheEntry,
} from "./types";

export function createViewCacheEntry<
  T extends TypedArray,
>(): ViewCacheEntry<T> {
  return { buffer: null, pointer: 0, length: 0, view: null };
}

export function getCachedView<T extends TypedArray>(
  entry: ViewCacheEntry<T>,
  buffer: ArrayBuffer,
  pointer: number,
  length: number,
  Constructor: TypedArrayConstructor<T>,
): T {
  const byteLength = length * Constructor.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer <= 0 ||
    length < 0 ||
    pointer + byteLength > buffer.byteLength
  ) {
    throw new RangeError(
      `Invalid Ghostty WASM view: ptr=${pointer}, length=${length}, bytes=${byteLength}`,
    );
  }
  if (
    entry.view &&
    entry.buffer === buffer &&
    entry.pointer === pointer &&
    entry.length === length
  ) {
    return entry.view;
  }

  const view = new Constructor(buffer, pointer, length);
  entry.buffer = buffer;
  entry.pointer = pointer;
  entry.length = length;
  entry.view = view;
  return view;
}
