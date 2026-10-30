import { isTauri } from "@tauri-apps/api/core";

let writing: Promise<void> | null = null;

export async function readTerminalClipboard(): Promise<string> {
  if (writing) await writing;
  if (isTauri()) {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  }
  if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
  return await navigator.clipboard.readText();
}

export function writeTerminalClipboard(text: string): Promise<void> {
  const pending = writing
    ? writing.catch(() => {}).then(() => writeClipboard(text))
    : writeClipboard(text);
  writing = pending;
  const clear = () => {
    if (writing === pending) writing = null;
  };
  void pending.then(clear, clear);
  return pending;
}

async function writeClipboard(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
  await navigator.clipboard.writeText(text);
}
