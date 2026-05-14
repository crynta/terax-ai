import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

type TempImage = {
  path: string;
};

export function firstClipboardImage(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of Array.from(items)) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}

export async function saveClipboardImage(file: File): Promise<string> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const result = await invoke<TempImage>("fs_write_clipboard_image", {
    bytes,
    mime: file.type || "image/png",
    workspace: currentWorkspaceEnv(),
  });
  return result.path;
}

export function terminalPathMention(path: string): string {
  return /\s/.test(path) ? `"${path.replace(/(["\\$`])/g, "\\$1")}" ` : `${path} `;
}
