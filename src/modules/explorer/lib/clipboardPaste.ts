import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { currentWorkspaceEnv } from "@/modules/workspace";

function parentDir(path: string, fallback: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : fallback;
}

// Paste lands inside the selected folder, beside the selected file, or at the
// root when nothing is selected.
export function pasteTargetDir(
  selected: string | null,
  isDir: (path: string) => boolean | undefined,
  rootPath: string,
): string {
  if (!selected) return rootPath;
  return isDir(selected) ? selected : parentDir(selected, rootPath);
}

export function isPasteShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  isMac: boolean,
): boolean {
  if (e.key.toLowerCase() !== "v" || e.altKey || e.shiftKey) return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

// Copies the files on the system clipboard (e.g. Cmd-C in Finder) into
// `destDir`. Name clashes get a Finder-style "copy" suffix rather than failing.
// Resolves to the created paths; empty when nothing was pasted.
export async function pasteClipboardFiles(destDir: string): Promise<string[]> {
  try {
    const sources = await invoke<string[]>("fs_clipboard_paths");
    if (sources.length === 0) {
      toast.message("No files on the clipboard");
      return [];
    }
    return await invoke<string[]>("fs_copy", {
      sources,
      destDir,
      workspace: currentWorkspaceEnv(),
      renameOnConflict: true,
    });
  } catch (err) {
    toast.error(`Paste failed: ${String(err)}`);
    return [];
  }
}
