import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceEnvStore, workspaceScopeKey } from "@/modules/workspace";

/** A view grants only its displayed file or Markdown image directory. */
export function useAssetGrant(path: string | null) {
  const workspace = useWorkspaceEnvStore((state) => state.env);
  const [attempt, setAttempt] = useState(0);
  const key = `${workspaceScopeKey(workspace)}:${path ?? ""}:${attempt}`;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const [grant, setGrant] = useState<{
    key: string;
    token?: string;
    error?: string;
  } | null>(null);
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
      .catch((error: unknown) => {
        if (!disposed) setGrant({ key, error: String(error) });
      });
    return () => {
      disposed = true;
      if (token) revoke(token);
    };
  }, [path, workspace, key]);
  const urlFor = useMemo(
    () => (asset: string) =>
      grant?.key === key && grant.token
        ? `${convertFileSrc(asset)}?token=${grant.token}`
        : undefined,
    [grant, key],
  );
  return { urlFor, error: grant?.key === key ? grant.error : undefined, retry };
}
