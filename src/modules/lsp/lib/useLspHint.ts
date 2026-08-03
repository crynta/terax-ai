import { resolveLanguage } from "@/modules/editor/lib/languageResolver";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { useEffect, useState } from "react";
import { detectBinary } from "./detect";
import { type LspPreset, serverForLanguage } from "./presets";
import { type LspSessionStatus, useLspRuntimeStore } from "./runtimeStore";

export type LspHint =
  | { kind: "enable"; preset: LspPreset }
  | { kind: "install"; preset: LspPreset }
  | { kind: "active"; preset: LspPreset; status: LspSessionStatus }
  | { kind: "error"; preset: LspPreset; reason: string };

export function useLspHint(filePath: string | null): LspHint | null {
  const [langId, setLangId] = useState<string | null>(null);
  const envKind = useWorkspaceEnvStore((s) => s.env.kind);

  useEffect(() => {
    if (!filePath) {
      setLangId(null);
      return;
    }
    let cancelled = false;
    void resolveLanguage(filePath).then((result) => {
      if (cancelled) return;
      const ext = filePath.split(".").pop()?.toLowerCase() ?? null;
      setLangId(result?.id || ext);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const customServers = usePreferencesStore((s) => s.lspCustomServers);
  const lspActivation = usePreferencesStore((s) => s.lspActivation);
  const preset = serverForLanguage(langId, customServers, lspActivation);
  const activation = preset ? lspActivation[preset.id] : undefined;
  const detected = useLspRuntimeStore((s) =>
    preset ? s.detected[preset.command] : undefined,
  );
  const session = useLspRuntimeStore((s) =>
    preset
      ? Object.values(s.sessions).find((x) => x.presetId === preset.id)
      : undefined,
  );
  const failure = useLspRuntimeStore((s) =>
    preset ? s.failed[preset.id] : undefined,
  );

  useEffect(() => {
    if (preset && envKind === "local" && activation === undefined) {
      void detectBinary(preset.command);
    }
  }, [preset, envKind, activation]);

  if (!preset || envKind !== "local") return null;
  if (activation === "dismissed") return null;
  if (activation === "enabled") {
    if (session) return { kind: "active", preset, status: session.status };
    if (failure) return { kind: "error", preset, reason: failure };
    return null;
  }
  if (detected === undefined) return null;
  return detected ? { kind: "enable", preset } : { kind: "install", preset };
}
