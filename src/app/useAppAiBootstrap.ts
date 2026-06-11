import { useEffect, useState } from "react";
import {
  getAllCustomEndpointKeys,
  getAllKeys,
  hasAnyKey,
} from "@/modules/ai/lib/keyring";
import { isE2eMockEnabled } from "@/modules/ai/lib/mockFlags";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useSnippetsStore } from "@/modules/ai/store/snippetsStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";

export function useAppAiBootstrap() {
  const miniOpen = useChatStore((s) => s.mini.open);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);

  useEffect(() => {
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
  }, []);

  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const hasLocalModel =
    (lmstudioModelId.trim() && lmstudioBaseURL.trim()) ||
    (mlxModelId.trim() && mlxBaseURL.trim()) ||
    (ollamaModelId.trim() && ollamaBaseURL.trim()) ||
    (openaiCompatibleModelId.trim() && openaiCompatibleBaseURL.trim()) ||
    customEndpoints.some((endpoint) => endpoint.modelId.trim());
  // The e2e mock provider is keyless, so let the flag satisfy the composer gate.
  const hasComposer =
    hasAnyKey(apiKeys) || Boolean(hasLocalModel) || isE2eMockEnabled();

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const sidebarPosition = usePreferencesStore((s) => s.sidebarPosition);
  const [keysLoaded, setKeysLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [keys, customKeys] = await Promise.all([
        getAllKeys(),
        getAllCustomEndpointKeys(
          usePreferencesStore.getState().customEndpoints,
        ),
      ]);
      if (!active) return;
      setApiKeys(keys);
      setCustomEndpointKeys(customKeys);
      setKeysLoaded(true);
    };
    void load();
    let unlisten: (() => void) | null = null;
    void onKeysChanged(load).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [setApiKeys, setCustomEndpointKeys]);

  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => void initPrefs(), [initPrefs]);
  useEffect(() => {
    if (prefsHydrated && prefDefaultModel) setSelectedModelId(prefDefaultModel);
  }, [prefDefaultModel, prefsHydrated, setSelectedModelId]);

  const hydrateSessions = useChatStore((s) => s.hydrateSessions);
  useEffect(() => {
    void hydrateSessions();
  }, [hydrateSessions]);

  return {
    focusInput,
    hasComposer,
    keysLoaded,
    miniOpen,
    openMini,
    openPanel,
    panelOpen,
    respondToApproval,
    setLive,
    sidebarPosition,
  };
}
