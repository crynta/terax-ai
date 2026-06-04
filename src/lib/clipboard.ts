import {
  readText as readTauriText,
  writeText as writeTauriText,
} from "@tauri-apps/plugin-clipboard-manager";

export type ClipboardAdapter = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
};

const tauriClipboard: ClipboardAdapter = {
  readText: readTauriText,
  writeText: writeTauriText,
};

function browserClipboard(): ClipboardAdapter | null {
  if (typeof navigator === "undefined") return null;
  const clipboard = navigator.clipboard;
  if (!clipboard?.readText || !clipboard.writeText) return null;
  return clipboard;
}

export async function writeClipboardText(
  text: string,
  primary: ClipboardAdapter = tauriClipboard,
  fallback: ClipboardAdapter | null = browserClipboard(),
): Promise<void> {
  try {
    await primary.writeText(text);
  } catch (error) {
    if (!fallback) throw error;
    await fallback.writeText(text);
  }
}

export async function readClipboardText(
  primary: ClipboardAdapter = tauriClipboard,
  fallback: ClipboardAdapter | null = browserClipboard(),
): Promise<string> {
  try {
    return await primary.readText();
  } catch (error) {
    if (!fallback) throw error;
    return fallback.readText();
  }
}
