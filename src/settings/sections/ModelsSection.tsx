import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  PROVIDERS,
  type ProviderId,
} from "@/modules/ai/config";
import {
  type CustomEndpointKeys,
  clearCustomEndpointKey,
  clearKey,
  getAllCustomEndpointKeys,
  getAllKeys,
  setCustomEndpointKey,
  setKey,
} from "@/modules/ai/lib/keyring";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  nextPiModelIdAfterCustomEndpointRemoval,
  type PiProviderPrefs,
} from "@/modules/pi/lib/provider";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setCustomEndpoints,
  setFavoriteModelIds,
  setLmstudioBaseURL,
  setLmstudioModelId,
  setMlxBaseURL,
  setMlxModelId,
  setOllamaBaseURL,
  setOllamaModelId,
  setOpenaiCompatibleBaseURL,
  setOpenaiCompatibleContextLimit,
  setOpenaiCompatibleModelId,
  setOpenrouterModelId,
  setPiModelId,
  setRecentModelIds,
} from "@/modules/settings/store";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";
import { DefaultsBlock } from "./ModelsSectionDefaults";
import {
  AddProviderMenu,
  CustomEndpointCard,
  LocalProviderCard,
} from "./ModelsSectionProviders";
import {
  isLocalProvider,
  type KeysMap,
  Label,
  LOCAL_META,
  type LocalConfig,
} from "./ModelsSectionShared";

function providerLabel(id: ProviderId): string {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

type PendingModelsDestructiveAction =
  | { kind: "provider-key"; provider: ProviderId; label: string }
  | { kind: "endpoint-key"; endpointId: string; name: string }
  | { kind: "endpoint"; endpointId: string; name: string }
  | { kind: "provider"; provider: ProviderId; label: string };

export function ModelsSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const [epKeys, setEpKeys] = useState<CustomEndpointKeys>({});
  const [adding, setAdding] = useState<Set<ProviderId>>(new Set());
  const [pendingDestructiveAction, setPendingDestructiveAction] =
    useState<PendingModelsDestructiveAction | null>(null);

  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const piAuthMode = usePreferencesStore((s) => s.piAuthMode);
  const piModelId = usePreferencesStore((s) => s.piModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const compatBaseURL = usePreferencesStore((s) => s.openaiCompatibleBaseURL);
  const compatModelId = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const compatContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const openrouterModelId = usePreferencesStore((s) => s.openrouterModelId);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);

  useEffect(() => {
    void getAllKeys().then(setKeys);
  }, []);

  useEffect(() => {
    void getAllCustomEndpointKeys(customEndpoints).then(setEpKeys);
  }, [customEndpoints]);

  const saveProviderKey = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    setKeys((prev) => (prev ? { ...prev, [provider]: value } : prev));
    await emitKeysChanged();
  };

  const clearProviderKey = async (provider: ProviderId) => {
    await clearKey(provider);
    setKeys((prev) => (prev ? { ...prev, [provider]: null } : prev));
    await emitKeysChanged();
  };

  const onSaveKey = async (provider: ProviderId, value: string) => {
    await saveProviderKey(provider, value);
  };

  const onClearKey = (provider: ProviderId) => {
    setPendingDestructiveAction({
      kind: "provider-key",
      provider,
      label: providerLabel(provider),
    });
  };

  const saveEndpointKey = async (endpointId: string, value: string) => {
    await setCustomEndpointKey(endpointId, value);
    setEpKeys((prev) => ({ ...prev, [endpointId]: value }));
    await emitKeysChanged();
  };

  const clearEndpointKey = async (endpointId: string) => {
    await clearCustomEndpointKey(endpointId);
    setEpKeys((prev) => ({ ...prev, [endpointId]: null }));
    await emitKeysChanged();
  };

  const onSaveEndpointKey = async (endpointId: string, value: string) => {
    await saveEndpointKey(endpointId, value);
  };

  const onClearEndpointKey = (endpointId: string) => {
    const endpointName =
      customEndpoints.find((endpoint) => endpoint.id === endpointId)?.name ||
      "custom endpoint";
    setPendingDestructiveAction({
      kind: "endpoint-key",
      endpointId,
      name: endpointName,
    });
  };

  const addCustomEndpoint = async () => {
    const ep: CustomEndpoint = {
      id: crypto.randomUUID().slice(0, 8),
      name: "",
      baseURL: "",
      modelId: "",
      contextLimit: 128_000,
    };
    await setCustomEndpoints([...customEndpoints, ep]);
  };

  const updateCustomEndpoint = async (
    id: string,
    patch: Partial<CustomEndpoint>,
  ) => {
    await setCustomEndpoints(
      customEndpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const removeCustomEndpoint = (id: string) => {
    const endpointName =
      customEndpoints.find((endpoint) => endpoint.id === id)?.name ||
      "custom endpoint";
    setPendingDestructiveAction({
      kind: "endpoint",
      endpointId: id,
      name: endpointName,
    });
  };

  const removeCustomEndpointNow = async (id: string) => {
    await clearEndpointKey(id);
    setEpKeys((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    // Drop the now-dead model id from favorites/recents before touching the
    // selection, so the recents push from a selection reset can't race it.
    const deadModelId = compatModelIdForEndpoint(id);
    const { favoriteModelIds, recentModelIds } = usePreferencesStore.getState();
    if (favoriteModelIds.includes(deadModelId)) {
      await setFavoriteModelIds(
        favoriteModelIds.filter((m) => m !== deadModelId),
      );
    }
    if (recentModelIds.includes(deadModelId)) {
      await setRecentModelIds(recentModelIds.filter((m) => m !== deadModelId));
    }

    // If the deleted endpoint was the active model, the selection would dangle
    // and the next send throws "Custom endpoint not found". Fall back to another
    // endpoint when one remains, else the default model.
    const remaining = customEndpoints.filter((e) => e.id !== id);
    const { selectedModelId, setSelectedModelId } = useChatStore.getState();
    if (selectedModelId === deadModelId) {
      setSelectedModelId(
        remaining[0]
          ? compatModelIdForEndpoint(remaining[0].id)
          : DEFAULT_MODEL_ID,
      );
    }
    const nextPiModelId = nextPiModelIdAfterCustomEndpointRemoval(
      piModelId,
      id,
      remaining,
    );
    if (nextPiModelId !== piModelId) {
      await setPiModelId(nextPiModelId);
    }

    await setCustomEndpoints(remaining);
  };

  const piProviderPrefs = useMemo<PiProviderPrefs>(
    () => ({
      piAuthMode,
      piModelId,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL: compatBaseURL,
      openaiCompatibleModelId: compatModelId,
      openaiCompatibleContextLimit: compatContextLimit,
      openrouterModelId,
      customEndpoints,
    }),
    [
      compatBaseURL,
      compatContextLimit,
      compatModelId,
      customEndpoints,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openrouterModelId,
      piAuthMode,
      piModelId,
    ],
  );

  const localConfig = (id: ProviderId): LocalConfig | null => {
    switch (id) {
      case "lmstudio":
        return {
          baseURL: lmstudioBaseURL,
          modelId: lmstudioModelId,
          setBaseURL: setLmstudioBaseURL,
          setModelId: setLmstudioModelId,
        };
      case "mlx":
        return {
          baseURL: mlxBaseURL,
          modelId: mlxModelId,
          setBaseURL: setMlxBaseURL,
          setModelId: setMlxModelId,
        };
      case "ollama":
        return {
          baseURL: ollamaBaseURL,
          modelId: ollamaModelId,
          setBaseURL: setOllamaBaseURL,
          setModelId: setOllamaModelId,
        };
      case "openai-compatible":
        return {
          baseURL: compatBaseURL,
          modelId: compatModelId,
          setBaseURL: setOpenaiCompatibleBaseURL,
          setModelId: setOpenaiCompatibleModelId,
          contextLimit: compatContextLimit,
          setContextLimit: setOpenaiCompatibleContextLimit,
        };
      case "openrouter":
        return {
          baseURL: "",
          modelId: openrouterModelId,
          setBaseURL: async () => {},
          setModelId: setOpenrouterModelId,
          noBaseURL: true,
        };
      default:
        return null;
    }
  };

  const isConfigured = (id: ProviderId): boolean => {
    if (id === "openrouter") return !!keys?.[id] && !!openrouterModelId.trim();
    if (!isLocalProvider(id)) return !!keys?.[id];
    const cfg = localConfig(id);
    if (!cfg) return false;
    if (id === "openai-compatible")
      return !!cfg.baseURL.trim() && !!cfg.modelId.trim();
    return !!cfg.modelId.trim();
  };

  if (!keys) {
    return <div className="text-[12px] text-muted-foreground">Loading…</div>;
  }

  const configuredIds = new Set(
    PROVIDERS.filter((p) => isConfigured(p.id)).map((p) => p.id),
  );
  const visibleIds = new Set<ProviderId>(configuredIds);
  for (const id of adding) visibleIds.add(id);
  const visibleProviders = PROVIDERS.filter(
    (p) => p.id !== "openai-compatible" && visibleIds.has(p.id),
  );
  const addableProviders = PROVIDERS.filter(
    (p) => p.id !== "openai-compatible" && !visibleIds.has(p.id),
  );

  const removeProvider = (id: ProviderId) => {
    setPendingDestructiveAction({
      kind: "provider",
      provider: id,
      label: providerLabel(id),
    });
  };

  const removeProviderNow = (id: ProviderId) => {
    if (id === "openrouter") {
      void setOpenrouterModelId("");
      void clearProviderKey(id);
    } else if (isLocalProvider(id)) {
      const cfg = localConfig(id);
      if (cfg) {
        void cfg.setModelId("");
        if (id === "openai-compatible") void cfg.setBaseURL("");
      }
      if (id === "openai-compatible") void clearProviderKey(id);
    } else {
      void clearProviderKey(id);
    }
    setAdding((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const addProvider = (id: ProviderId) => {
    setAdding((prev) => new Set(prev).add(id));
  };

  const pendingDestructiveCopy = (() => {
    if (!pendingDestructiveAction) return null;
    switch (pendingDestructiveAction.kind) {
      case "provider-key":
        return {
          title: "Remove API key?",
          description: `This removes the saved ${pendingDestructiveAction.label} API key from your keychain.`,
          action: "Remove key",
        };
      case "endpoint-key":
        return {
          title: "Remove endpoint API key?",
          description: `This removes the saved API key for ${pendingDestructiveAction.name}.`,
          action: "Remove key",
        };
      case "endpoint":
        return {
          title: "Remove custom endpoint?",
          description: `This removes ${pendingDestructiveAction.name}, clears its key, and removes dependent favorites, recents, and active selections.`,
          action: "Remove endpoint",
        };
      case "provider":
        return {
          title: "Remove provider?",
          description: `This removes ${pendingDestructiveAction.label}, clears its saved key, and resets provider settings.`,
          action: "Remove provider",
        };
    }
  })();

  const confirmPendingDestructiveAction = () => {
    const action = pendingDestructiveAction;
    setPendingDestructiveAction(null);
    if (!action) return;
    if (action.kind === "provider-key") {
      void clearProviderKey(action.provider);
    } else if (action.kind === "endpoint-key") {
      void clearEndpointKey(action.endpointId);
    } else if (action.kind === "endpoint") {
      void removeCustomEndpointNow(action.endpointId);
    } else {
      removeProviderNow(action.provider);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Connect the providers you use. Keys live in your OS keychain and are used only by Terax."
      />

      <DefaultsBlock
        defaultModel={defaultModel}
        piProviderPrefs={piProviderPrefs}
        configuredIds={configuredIds}
        keys={keys}
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>Providers</Label>
          <AddProviderMenu
            providers={addableProviders}
            onAdd={addProvider}
            onAddCompat={addCustomEndpoint}
          />
        </div>

        {visibleProviders.length === 0 && customEndpoints.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-card/40 px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              No providers connected yet.
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
              Click "Add provider" to connect a cloud or local model source.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleProviders.map((p) =>
              p.id === "openrouter" ? (
                <LocalProviderCard
                  key={p.id}
                  provider={p}
                  configured={configuredIds.has(p.id)}
                  config={localConfig(p.id)!}
                  meta={LOCAL_META[p.id]!}
                  compatKey={keys[p.id]}
                  onSaveKey={(v) => onSaveKey(p.id, v)}
                  onClearKey={() => onClearKey(p.id)}
                  onRemove={() => removeProvider(p.id)}
                />
              ) : isLocalProvider(p.id) ? (
                <LocalProviderCard
                  key={p.id}
                  provider={p}
                  configured={configuredIds.has(p.id)}
                  config={localConfig(p.id)!}
                  meta={LOCAL_META[p.id]!}
                  onSaveKey={(v) => onSaveKey(p.id, v)}
                  onClearKey={() => onClearKey(p.id)}
                  onRemove={() => removeProvider(p.id)}
                />
              ) : (
                <ProviderKeyCard
                  key={p.id}
                  provider={p}
                  currentKey={keys[p.id]}
                  onSave={(v) => onSaveKey(p.id, v)}
                  onClear={() => onClearKey(p.id)}
                  onRemove={() => removeProvider(p.id)}
                />
              ),
            )}
            {customEndpoints.map((ep) => (
              <CustomEndpointCard
                key={ep.id}
                endpoint={ep}
                endpointKey={epKeys[ep.id] ?? null}
                onSaveKey={(v) => onSaveEndpointKey(ep.id, v)}
                onClearKey={() => onClearEndpointKey(ep.id)}
                onUpdate={(patch) => updateCustomEndpoint(ep.id, patch)}
                onRemove={() => removeCustomEndpoint(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
      <AlertDialog
        open={pendingDestructiveAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDestructiveAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDestructiveCopy?.title ?? "Confirm removal"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDestructiveCopy?.description ?? ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmPendingDestructiveAction}
            >
              {pendingDestructiveCopy?.action ?? "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
