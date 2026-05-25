import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodePlantUml } from "./lib/encode";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type PlantUmlResult = {
  svg: string | null;
  error: string | null;
};

type Status =
  | { kind: "loading" }
  | { kind: "rendering" }
  | { kind: "ready"; svg: string }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
};

export function PlantUmlPreviewPane({ path, visible }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const lastContentHash = useRef("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const render = useCallback(async (text: string) => {
    const hash = simpleHash(text);
    if (hash === lastContentHash.current) return;
    lastContentHash.current = hash;

    setStatus({ kind: "rendering" });

    const { plantumlBackend, plantumlServerUrl, plantumlJarPath, plantumlJavaPath } =
      usePreferencesStore.getState();

    try {
      let svg: string;
      if (plantumlBackend === "local" && plantumlJarPath) {
        const result = await invoke<PlantUmlResult>("plantuml_render_local", {
          diagramText: text,
          jarPath: plantumlJarPath,
          javaPath: plantumlJavaPath || "java",
        });
        if (result.svg) {
          svg = result.svg;
        } else {
          setStatus({ kind: "error", message: result.error ?? "No output from PlantUML" });
          return;
        }
      } else {
        const encoded = await encodePlantUml(text);
        const serverUrl = plantumlServerUrl || undefined;
        svg = await invoke<string>("plantuml_fetch_svg", { encoded, serverUrl });
      }
      setStatus({ kind: "ready", svg });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  const loadAndRender = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const res = await invoke<ReadResult>("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
      });
      if (res.kind === "text") {
        await render(res.content);
      } else if (res.kind === "binary") {
        setStatus({ kind: "error", message: "Binary file cannot be rendered as PlantUML." });
      } else {
        setStatus({ kind: "error", message: `File too large: ${res.size} bytes.` });
      }
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [path, render]);

  useEffect(() => {
    void loadAndRender();
  }, [loadAndRender]);

  useEffect(() => {
    const handler = (event: CustomEvent<{ paths: string[] }>) => {
      if (!event.detail.paths.some((p) => p === path)) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void loadAndRender(), 500);
    };
    window.addEventListener("fs:changed" as string, handler as EventListener);
    return () => {
      clearTimeout(debounceRef.current);
      window.removeEventListener("fs:changed" as string, handler as EventListener);
    };
  }, [path, loadAndRender]);

  const dataUrl =
    status.kind === "ready"
      ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(status.svg)))}`
      : null;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border/60 px-3">
        <span className="text-xs text-muted-foreground">PlantUML Preview</span>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {status.kind === "loading" && (
          <p className="text-[12px] text-muted-foreground">Loading...</p>
        )}
        {status.kind === "rendering" && (
          <p className="text-[12px] text-muted-foreground">Rendering diagram...</p>
        )}
        {status.kind === "error" && (
          <p className="max-w-md whitespace-pre-wrap text-[12px] text-destructive">
            {status.message}
          </p>
        )}
        {status.kind === "ready" && dataUrl && (
          <img
            src={dataUrl}
            alt="PlantUML diagram"
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
