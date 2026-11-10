import { hostState, rpc } from "../bridge";

type InvokeOptions = { headers?: Record<string, string> };

/** Tauri's `invoke`, answered by the extension host. */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array | ArrayBuffer,
  options?: InvokeOptions,
): Promise<T> {
  if (args instanceof Uint8Array || args instanceof ArrayBuffer) {
    // Raw-body commands (pasted images) travel as base64.
    const bytes = args instanceof Uint8Array ? args : new Uint8Array(args);
    return rpc<T>(cmd, {
      bytes: toBase64(bytes),
      type: options?.headers?.["x-terax-image-type"] ?? "",
    });
  }
  return rpc<T>(cmd, args ?? {});
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** A local file as a webview resource URL (pasted-image previews). */
export function convertFileSrc(filePath: string): string {
  const base = hostState.env?.resourceBase ?? "";
  return `${base}${filePath.split("/").map(encodeURIComponent).join("/")}`;
}
