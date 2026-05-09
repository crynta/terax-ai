import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AUTOCOMPLETE_PROVIDERS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  MODELS,
  PROVIDERS,
  fetchOpenRouterModels,
  getProvider,
  providerNeedsKey,
  resolveModel,
  type AutocompleteProviderId,
  type OpenRouterModel,
  type ProviderId,
} from "@/modules/ai/config";
import { clearKey, getAllKeys, setKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setDefaultModel,
  setLmstudioBaseURL,
  toggleOpenrouterFavorite,
} from "@/modules/settings/store";
import { ArrowDown01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

export function ModelsSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const [orModels, setOrModels] = useState<OpenRouterModel[]>([]);
  const [orSearch, setOrSearch] = useState("");
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const favorites = usePreferencesStore((s) => s.openrouterFavorites);
  const favoriteSet = new Set(favorites);

  const loadOrModels = useCallback((keysMap: KeysMap) => {
    const key = keysMap["openrouter"];
    if (!key) return;
    void fetchOpenRouterModels(key).then(setOrModels).catch(() => {});
  }, []);

  useEffect(() => {
    void getAllKeys().then((k) => {
      setKeys(k);
      loadOrModels(k);
    });
  }, [loadOrModels]);

  const onSave = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    const next = keys ? { ...keys, [provider]: value } : null;
    setKeys(next);
    if (next) loadOrModels(next);
    await emitKeysChanged();
  };

  const onClear = async (provider: ProviderId) => {
    await clearKey(provider);
    setKeys((prev) => (prev ? { ...prev, [provider]: null } : prev));
    await emitKeysChanged();
  };

  if (!keys) {
    return <div className="text-[12px] text-muted-foreground">Loading…</div>;
  }

  const defaultModelInfo = resolveModel(defaultModel);
  const configuredCount = PROVIDERS.filter(
    (p) => providerNeedsKey(p.id) && !!keys[p.id],
  ).length;

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Bring your own keys. They live in your OS keychain and are used only by Terax."
      />

      <div className="flex flex-col gap-2">
        <Label>Default model</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 justify-between gap-2 px-2.5 text-[12px]"
            >
              <span className="flex items-center gap-2">
                <ProviderIcon provider={defaultModelInfo.provider} size={14} />
                <span>{defaultModelInfo.label}</span>
                <span className="text-muted-foreground">
                  · {defaultModelInfo.hint}
                </span>
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                strokeWidth={2}
                className="opacity-70"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[280px]">
            {PROVIDERS.filter((p) => providerNeedsKey(p.id) && !!keys[p.id]).map((p) => {
              const staticModels = MODELS.filter((m) => m.provider === p.id);
              const hasKey = !!keys[p.id];
              const q = orSearch.trim().toLowerCase();
              const filteredOrModels = q
                ? orModels.filter(
                    (m) =>
                      m.name.toLowerCase().includes(q) ||
                      m.id.toLowerCase().includes(q),
                  )
                : orModels.filter((m) => favoriteSet.has(m.id));
              return (
                <div key={p.id} className="px-1 pt-1.5">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider={p.id} size={11} />
                    <span>{p.label}</span>
                    {!hasKey && (
                      <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                        no key
                      </span>
                    )}
                  </div>
                  {p.id === "openrouter" ? (
                    hasKey ? (
                      <>
                        <div
                          className="px-1 pb-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            value={orSearch}
                            onChange={(e) => setOrSearch(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder={
                              orModels.length
                                ? `Search ${orModels.length} models…`
                                : "Loading models…"
                            }
                            className="h-7 text-[11px]"
                          />
                        </div>
                        <div className="max-h-[220px] overflow-y-auto">
                          {filteredOrModels.length === 0 && !q ? (
                            <div className="px-2 py-3 text-[10.5px] text-muted-foreground">
                              No favorites yet — search and tap the star to pin
                              models here.
                            </div>
                          ) : null}
                          {filteredOrModels.map((m) => {
                            const isFav = favoriteSet.has(m.id);
                            return (
                              <DropdownMenuItem
                                key={m.id}
                                onSelect={() => void setDefaultModel(m.id)}
                                className={cn(
                                  "flex items-start gap-2 text-[12px]",
                                  m.id === defaultModel && "bg-accent/50",
                                )}
                              >
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="truncate">{m.name}</span>
                                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                                    {m.id}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void toggleOpenrouterFavorite(m.id);
                                  }}
                                  title={
                                    isFav
                                      ? "Remove from favorites"
                                      : "Add to favorites"
                                  }
                                  className={cn(
                                    "shrink-0 rounded p-0.5 transition-colors",
                                    isFav
                                      ? "text-amber-400 hover:text-amber-500"
                                      : "text-muted-foreground/40 hover:text-foreground",
                                  )}
                                >
                                  <HugeiconsIcon
                                    icon={StarIcon}
                                    size={12}
                                    strokeWidth={isFav ? 2.5 : 1.75}
                                  />
                                </button>
                              </DropdownMenuItem>
                            );
                          })}
                        </div>
                      </>
                    ) : null
                  ) : (
                    staticModels.map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        disabled={!hasKey}
                        onSelect={() => hasKey && void setDefaultModel(m.id)}
                        className={cn(
                          "flex items-center justify-between gap-2 text-[12px]",
                          m.id === defaultModel && "bg-accent/50",
                        )}
                      >
                        <span className="flex flex-col">
                          <span>{m.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {m.hint}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>API keys</Label>
          <span className="text-[10.5px] text-muted-foreground">
            {configuredCount} of {PROVIDERS.filter((p) => providerNeedsKey(p.id)).length} configured
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PROVIDERS.filter((p) => providerNeedsKey(p.id)).map((p) => (
            <ProviderKeyCard
              key={p.id}
              provider={p}
              currentKey={keys[p.id]}
              onSave={(v: string) => onSave(p.id, v)}
              onClear={() => onClear(p.id)}
            />
          ))}
        </div>
      </div>

      <AutocompleteBlock keys={keys} />
    </div>
  );
}

function AutocompleteBlock({ keys }: { keys: KeysMap }) {
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const provider = usePreferencesStore((s) => s.autocompleteProvider);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);

  const [modelDraft, setModelDraft] = useState(modelId);
  const [urlDraft, setUrlDraft] = useState(lmstudioBaseURL);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");

  useEffect(() => setModelDraft(modelId), [modelId]);
  useEffect(() => setUrlDraft(lmstudioBaseURL), [lmstudioBaseURL]);

  const onProviderChange = (next: AutocompleteProviderId) => {
    void setAutocompleteProvider(next);
    const knownDefaults = Object.values(DEFAULT_AUTOCOMPLETE_MODEL);
    if (knownDefaults.includes(modelId)) {
      void setAutocompleteModelId(DEFAULT_AUTOCOMPLETE_MODEL[next]);
    }
  };

  const providerInfo = getProvider(provider);
  const hasKey = providerNeedsKey(provider) ? !!keys[provider] : true;

  const testLmStudio = async () => {
    setTestStatus("testing");
    try {
      const url = urlDraft.replace(/\/$/, "") + "/models";
      const res = await fetch(url, { method: "GET" });
      setTestStatus(res.ok ? "ok" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>Editor autocomplete</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Inline ghost-text suggestions in the code editor. Powered by
            ultra-fast inference (Cerebras / Groq) or a local LM Studio server.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setAutocompleteEnabled(v)}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          <Label>Provider</Label>
          <div className="flex gap-1">
            {AUTOCOMPLETE_PROVIDERS.map((id) => {
              const info = getProvider(id);
              const active = id === provider;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onProviderChange(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors",
                    active
                      ? "border-foreground/40 bg-accent/60"
                      : "border-border/60 bg-transparent hover:bg-accent/30",
                  )}
                >
                  <ProviderIcon provider={id} size={12} />
                  <span>{info.label}</span>
                </button>
              );
            })}
          </div>
          {!hasKey ? (
            <span className="text-[10.5px] text-amber-500">
              No API key configured for {providerInfo.label}. Add one above.
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Model</Label>
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              const v = modelDraft.trim();
              if (v && v !== modelId) void setAutocompleteModelId(v);
            }}
            placeholder={DEFAULT_AUTOCOMPLETE_MODEL[provider]}
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </div>

        {provider === "lmstudio" ? (
          <div className="flex flex-col gap-1.5">
            <Label>LM Studio base URL</Label>
            <div className="flex gap-1.5">
              <Input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => {
                  const v = urlDraft.trim();
                  if (v && v !== lmstudioBaseURL) void setLmstudioBaseURL(v);
                }}
                placeholder="http://localhost:1234/v1"
                spellCheck={false}
                className="h-8 flex-1 font-mono text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void testLmStudio()}
                className="h-8 px-2.5 text-[11px]"
              >
                Test
              </Button>
            </div>
            {testStatus === "ok" ? (
              <span className="text-[10.5px] text-emerald-500">
                Connected — server responded.
              </span>
            ) : testStatus === "fail" ? (
              <span className="text-[10.5px] text-destructive">
                Could not reach the server. Is LM Studio running?
              </span>
            ) : testStatus === "testing" ? (
              <span className="text-[10.5px] text-muted-foreground">
                Testing…
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
