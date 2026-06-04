import {
  readText as readNativeText,
  writeText as writeNativeText,
} from "@tauri-apps/plugin-clipboard-manager";

function getWebClipboard(): Clipboard | null {
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboard(): Promise<string> {
  try {
    return await readNativeText();
  } catch {
    // WebKit on Linux can fail to read external clipboard content through the
    // web clipboard API, but it remains a useful fallback in browser contexts.
  }

  try {
    return (await getWebClipboard()?.readText()) ?? "";
  } catch {
    return "";
  }
}

export async function writeTerminalClipboard(text: string): Promise<void> {
  try {
    await writeNativeText(text);
    return;
  } catch {
    // Keep the existing browser clipboard behavior as a fallback for dev/web.
  }

  try {
    await getWebClipboard()?.writeText(text);
  } catch {
    // Best-effort copy path.
  }
}
