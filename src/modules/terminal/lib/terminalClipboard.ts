import { isTauri } from "@tauri-apps/api/core";

let pendingNativeWrite: Promise<void> | null = null;

export async function readTerminalClipboard(): Promise<string> {
  try {
    if (isTauri()) {
      if (pendingNativeWrite) await pendingNativeWrite;
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
    const write = async () => {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
    };
    const pending = pendingNativeWrite
      ? pendingNativeWrite.catch(() => {}).then(write)
      : write();
    pendingNativeWrite = pending;
    try {
      await pending;
    } finally {
      if (pendingNativeWrite === pending) pendingNativeWrite = null;
    }
    return;
  }
  if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
  await navigator.clipboard.writeText(text);
}
