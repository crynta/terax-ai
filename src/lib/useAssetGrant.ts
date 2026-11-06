import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceEnvStore, workspaceScopeKey } from "@/modules/workspace";

/** A view grants only its displayed file or Markdown image directory. */
export function useAssetGrant(path: string | null) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const key = `${workspaceScopeKey(workspace)}:${path ?? ""}`;
  const [grant, setGrant] = useState<{ key: string; token: string } | null>(
    null,
  );
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let token: string | null = null;
    const revoke = (value: string) =>
      void invoke("asset_revoke", { token: value }).catch(console.error);
    void invoke<string>("asset_grant", { path, workspace })
      .then((value) => {
        if (disposed) revoke(value);
        else {
          token = value;
          setGrant({ key, token: value });
        }
      })
      .catch(console.error);
    return () => {
      disposed = true;
      if (token) revoke(token);
    };
  }, [path, workspace, key]);
  return useMemo(
    () => (asset: string) =>
      grant?.key === key
        ? `${convertFileSrc(asset)}?token=${grant.token}`
        : undefined,
    [grant, key],
  );
}
