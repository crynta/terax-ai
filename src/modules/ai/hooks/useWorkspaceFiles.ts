import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";

export type WorkspaceFilesState = {
  files: string[];
  indexing: boolean;
  truncated: boolean;
};

type ListFilesResult = { files: string[]; truncated: boolean };

export function useWorkspaceFiles(
  workspaceRoot: string | null,
): WorkspaceFilesState {
  const [state, setState] = useState<WorkspaceFilesState>({
    files: [],
    indexing: false,
    truncated: false,
  });

  useEffect(() => {
    if (!workspaceRoot) {
      setState({ files: [], indexing: false, truncated: false });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, indexing: true }));
    invoke<ListFilesResult>("fs_list_files", {
      root: workspaceRoot,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (cancelled) return;
        setState({
          files: res.files,
          truncated: res.truncated,
          indexing: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ files: [], indexing: false, truncated: false });
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  return state;
}
