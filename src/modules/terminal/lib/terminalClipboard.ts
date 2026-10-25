import { isTauri } from "@tauri-apps/api/core";

export async function readTerminalClipboard(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  }
  if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
  return await navigator.clipboard.readText();
}

export async function writeTerminalClipboard(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
  await navigator.clipboard.writeText(text);
}
