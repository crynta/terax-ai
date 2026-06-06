import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import type { WorkflowArtifactFileSystem } from "./artifactStorage";

export const tauriWorkflowArtifactFileSystem: WorkflowArtifactFileSystem = {
  createDirectory: async (path) => {
    try {
      await invoke<void>("fs_create_dir", {
        path,
        workspace: currentWorkspaceEnv(),
      });
    } catch (error) {
      if (!String(error).includes("already exists")) throw error;
    }
  },
  copyFile: (from, to, source) =>
    invoke<void>("fs_copy_file", {
      from,
      to,
      workspace: currentWorkspaceEnv(),
      source,
    }),
  openFile: (path) =>
    invoke<void>("fs_open_file", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  writeFile: (path, content, source) =>
    invoke<void>("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source,
    }),
  writeBase64File: (path, contentBase64, source) =>
    invoke<void>("fs_write_base64_file", {
      path,
      contentBase64,
      workspace: currentWorkspaceEnv(),
      source,
    }),
};

export function workflowArtifactNativePreviewSource(source: string): string {
  if (isBrowserRenderableSource(source)) return source;
  return convertFileSrc(source);
}

function isBrowserRenderableSource(source: string): boolean {
  return /^(data:|blob:|https?:|asset:|file:)/i.test(source);
}
