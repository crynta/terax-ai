import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { WorkspaceEnv } from "@/modules/workspace";

export function parentDir(path: string, fallback: string): string {
  const i = path.lastIndexOf("/");
  if (i === 0) return "/";
  if (i === 2 && /^[a-z]:\//i.test(path)) return path.slice(0, 3);
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

export type CopyResult = {
  created: string[];
  failed: { source: string; message: string }[];
};

type PasteOptions = {
  root: string;
  workspace: WorkspaceEnv;
  isCurrent: () => boolean;
  refresh: (destDir: string) => Promise<boolean>;
};

export function reportCopyFailures(result: CopyResult): void {
  if (result.failed.length === 0) return;
  const first = result.failed[0];
  const count = result.failed.length;
  toast.error(`Could not copy ${count} ${count === 1 ? "item" : "items"}`, {
    description: `${first.source}: ${first.message}`,
  });
}

export async function pasteClipboardFiles(
  destDir: string,
  { root, workspace, isCurrent, refresh }: PasteOptions,
): Promise<string[]> {
  let copyStarted = false;
  try {
    const sources = await invoke<string[]>("fs_clipboard_paths");
    if (!isCurrent()) return [];
    if (sources.length === 0) {
      toast.message("No files on the clipboard");
      return [];
    }
    copyStarted = true;
    const result = await invoke<CopyResult>("fs_copy", {
      sources,
      destDir,
      root,
      workspace,
      renameOnConflict: true,
    });
    reportCopyFailures(result);
    if (!isCurrent()) return [];
    const refreshed = await refresh(destDir);
    return refreshed && isCurrent() ? result.created : [];
  } catch (err) {
    toast.error(`Paste failed: ${String(err)}`);
    if (copyStarted && isCurrent()) await refresh(destDir);
    return [];
  }
}
