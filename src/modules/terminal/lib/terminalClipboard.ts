import { isTauri } from "@tauri-apps/api/core";

export async function readTerminalClipboard(): Promise<string> {
  try {
    if (isTauri()) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    }
    return (await navigator.clipboard?.readText()) ?? "";
  } catch {
    return "";
  }
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
