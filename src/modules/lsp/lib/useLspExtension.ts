import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Extension } from "@codemirror/state";
import { useEffect, useState } from "react";
import { serverForLanguage } from "./presets";
import { useLspRuntimeStore } from "./runtimeStore";
import { acquireDocExtension, type LspDocHandle } from "./sessionManager";

export function useLspExtension(
  path: string,
  langId: string | null,
  ready: boolean,
): Extension | null {
  const [ext, setExt] = useState<Extension | null>(null);
  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const lspActivation = usePreferencesStore((s) => s.lspActivation);
  const preset = serverForLanguage(langId, customServers, lspActivation);
  const activation = preset ? lspActivation[preset.id] : undefined;
  const generation = useLspRuntimeStore((s) =>
    preset ? (s.generations[preset.id] ?? 0) : 0,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies(generation): re-acquire after a server crash tears the session down
  useEffect(() => {
    if (!ready || !langId || activation !== "enabled") {
      setExt(null);
      return;
    }
    let cancelled = false;
    let handle: LspDocHandle | null = null;
    acquireDocExtension(path, langId)
      .then((h) => {
        if (!h) return;
        if (cancelled) {
          h.release();
          return;
        }
        handle = h;
        setExt(h.extension);
      })
      .catch((e) => console.error("[lsp] acquire failed", e));
    return () => {
      cancelled = true;
      handle?.release();
      setExt(null);
    };
  }, [path, langId, ready, activation, generation]);

  return ext;
}
