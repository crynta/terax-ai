import {
  readText as readNativeText,
  writeText as writeNativeText,
} from "@tauri-apps/plugin-clipboard-manager";

type WebClipboard = Pick<Clipboard, "readText" | "writeText">;

type ClipboardDeps = {
  nativeReadText?: () => Promise<string>;
  nativeWriteText?: (text: string) => Promise<void>;
  webClipboard?: WebClipboard | null;
};

function resolveWebClipboard(
  explicit: ClipboardDeps["webClipboard"],
): WebClipboard | null {
  if (explicit !== undefined) return explicit ?? null;
  if (typeof navigator === "undefined") return null;
  return navigator.clipboard ?? null;
}

export async function readTerminalClipboardText(
  deps: ClipboardDeps = {},
): Promise<string> {
  const nativeRead = deps.nativeReadText ?? readNativeText;
  try {
    return await nativeRead();
  } catch {
    const webClipboard = resolveWebClipboard(deps.webClipboard);
    if (!webClipboard?.readText) return "";
    try {
      return await webClipboard.readText();
    } catch {
      return "";
    }
  }
}

export async function writeTerminalClipboardText(
  text: string,
  deps: ClipboardDeps = {},
): Promise<void> {
  const nativeWrite = deps.nativeWriteText ?? writeNativeText;
  try {
    await nativeWrite(text);
    return;
  } catch {
    const webClipboard = resolveWebClipboard(deps.webClipboard);
    if (!webClipboard?.writeText) {
      throw new Error("clipboard unavailable");
    }
    await webClipboard.writeText(text);
  }
}
