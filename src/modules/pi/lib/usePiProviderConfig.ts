import { useMemo } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type PiProviderPrefs,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";

export function usePiProviderConfig() {
  const piAuthMode = usePreferencesStore((state) => state.piAuthMode);
  const piModelId = usePreferencesStore((state) => state.piModelId);
  const lmstudioBaseURL = usePreferencesStore((state) => state.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((state) => state.mlxBaseURL);
  const mlxModelId = usePreferencesStore((state) => state.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((state) => state.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((state) => state.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const openaiCompatibleContextLimit = usePreferencesStore(
    (state) => state.openaiCompatibleContextLimit,
  );
  const openrouterModelId = usePreferencesStore(
    (state) => state.openrouterModelId,
  );
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);

  const prefs = useMemo<PiProviderPrefs>(
    () => ({
      piAuthMode,
      piModelId,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleModelId,
      openaiCompatibleContextLimit,
      openrouterModelId,
      customEndpoints,
    }),
    [
      customEndpoints,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleContextLimit,
      openaiCompatibleModelId,
      openrouterModelId,
      piAuthMode,
      piModelId,
    ],
  );

  const result = useMemo(() => resolvePiProviderConfig(prefs), [prefs]);
  const thinkingScope = result.ok
    ? `${result.config.authMode}:${result.config.provider}:${result.config.modelId}:${result.config.sourceModelId}`
    : "unavailable";

  return { prefs, result, thinkingScope };
}
