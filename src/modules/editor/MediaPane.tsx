import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { useEffect, useState } from "react";

type Props = {
  path: string;
};

export function MediaPane({ path }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);

    invoke<string>("fs_read_binary", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const basename = path.split("/").pop() ?? path;

  return (
    <div className="flex h-full w-full items-center justify-center bg-background/50">
      {error ? (
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <div className="text-sm text-foreground">Cannot preview</div>
          <div className="text-xs text-muted-foreground">{error}</div>
        </div>
      ) : !dataUrl ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex h-full w-full items-center justify-center p-8">
          <img
            src={dataUrl}
            alt={basename}
            className="max-h-full max-w-full object-contain drop-shadow-md"
          />
        </div>
      )}
    </div>
  );
}
