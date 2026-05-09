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
  getModel,
  getProvider,
  providerNeedsKey,
  type AutocompleteProviderId,
  type CustomProvider,
  type ModelId,
  type ProviderId,
} from "@/modules/ai/config";
import { clearKey, getAllKeys, setKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setCustomProviders,
  setDefaultModel,
  setLmstudioBaseURL,
} from "@/modules/settings/store";
import {
  Add01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
  LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

export function ModelsSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const customProviders = usePreferencesStore((s) => s.customProviders);

  useEffect(() => {
    void getAllKeys().then(setKeys);
  }, []);

  const onSave = async (provider: ProviderId, value: string) => {
    await setKey(provider, value);
    setKeys((prev) => (prev ? { ...prev, [provider]: value } : prev));
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

  const isCustomModel = defaultModel.startsWith("custom:");
  const defaultModelLabel = isCustomModel
    ? (() => {
        const [, cpId, mId] = defaultModel.split(":");
        const cp = customProviders.find((c) => c.id === cpId);
        return { label: mId ?? "unknown", hint: cp?.name ?? "Custom", provider: null };
      })()
    : getModel(defaultModel);

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
                {!isCustomModel && (
                  <ProviderIcon
                    provider={(defaultModelLabel as { provider: ProviderId }).provider}
                    size={14}
                  />
                )}
                {isCustomModel && (
                  <HugeiconsIcon icon={LinkSquare01Icon} size={14} strokeWidth={1.75} className="text-muted-foreground" />
                )}
                <span>{defaultModelLabel.label}</span>
                <span className="text-muted-foreground">
                  · {defaultModelLabel.hint}
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
          <DropdownMenuContent align="start" className="min-w-[260px] max-h-[360px] overflow-y-auto">
            {PROVIDERS.filter((p) => providerNeedsKey(p.id)).map((p) => {
              const models = MODELS.filter((m) => m.provider === p.id);
              const hasKey = !!keys[p.id];
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
                  {models.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      disabled={!hasKey}
                      onSelect={() =>
                        hasKey && void setDefaultModel(m.id as ModelId)
                      }
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
                  ))}
                </div>
              );
            })}
            {customProviders.length > 0 &&
              customProviders.map((cp) => (
                <div key={cp.id} className="px-1 pt-1.5">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <HugeiconsIcon icon={LinkSquare01Icon} size={11} strokeWidth={1.75} />
                    <span>{cp.name}</span>
                  </div>
                  {cp.models.map((mId) => (
                    <DropdownMenuItem
                      key={`${cp.id}:${mId}`}
                      onSelect={() =>
                        void setDefaultModel(`custom:${cp.id}:${mId}` as ModelId)
                      }
                      className={cn(
                        "flex items-center justify-between gap-2 text-[12px]",
                        defaultModel === `custom:${cp.id}:${mId}` && "bg-accent/50",
                      )}
                    >
                      <span className="flex flex-col">
                        <span>{mId}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {cp.name}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
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

      <CustomProvidersBlock />

      <AutocompleteBlock keys={keys} customProviders={customProviders} />
    </div>
  );
}

function AutocompleteBlock({
  keys,
  customProviders,
}: {
  keys: KeysMap;
  customProviders: CustomProvider[];
}) {
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

  const isCustomProvider = provider.startsWith("custom:");

  const onProviderChange = (next: string) => {
    if (next === provider) return;
    void setAutocompleteProvider(next as AutocompleteProviderId);
    if (!next.startsWith("custom:")) {
      const knownDefaults = Object.values(DEFAULT_AUTOCOMPLETE_MODEL);
      if (knownDefaults.includes(modelId)) {
        void setAutocompleteModelId(
          DEFAULT_AUTOCOMPLETE_MODEL[next as keyof typeof DEFAULT_AUTOCOMPLETE_MODEL],
        );
      }
    } else {
      const cpId = next.replace("custom:", "");
      const cp = customProviders.find((c) => c.id === cpId);
      if (cp && cp.models.length > 0) {
        void setAutocompleteModelId(cp.models[0]);
      }
    }
  };

  const hasKey = isCustomProvider
    ? true
    : providerNeedsKey(provider as ProviderId)
      ? !!keys[provider as ProviderId]
      : true;

  const providerLabel = isCustomProvider
    ? customProviders.find((c) => c.id === provider.replace("custom:", ""))?.name ?? "Custom"
    : getProvider(provider as ProviderId).label;

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
            ultra-fast inference (Cerebras / Groq), a local server, or a custom provider.
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
          <div className="flex flex-wrap gap-1">
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
            {customProviders.map((cp) => {
              const active = provider === `custom:${cp.id}`;
              return (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => onProviderChange(`custom:${cp.id}`)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] transition-colors",
                    active
                      ? "border-foreground/40 bg-accent/60"
                      : "border-border/60 bg-transparent hover:bg-accent/30",
                  )}
                >
                  <HugeiconsIcon icon={LinkSquare01Icon} size={12} strokeWidth={1.75} />
                  <span>{cp.name}</span>
                </button>
              );
            })}
          </div>
          {!hasKey ? (
            <span className="text-[10.5px] text-amber-500">
              No API key configured for {providerLabel}. Add one above.
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
            placeholder={
              isCustomProvider
                ? "model-id"
                : DEFAULT_AUTOCOMPLETE_MODEL[provider as keyof typeof DEFAULT_AUTOCOMPLETE_MODEL]
            }
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

function CustomProvidersBlock() {
  const customProviders = usePreferencesStore((s) => s.customProviders);
  const [editing, setEditing] = useState<string | null>(null);

  const save = (updated: CustomProvider[]) => {
    void setCustomProviders(updated);
  };

  const addProvider = () => {
    const id = `cp_${Date.now().toString(36)}`;
    const next: CustomProvider = {
      id,
      name: "",
      baseURL: "",
      apiKey: "",
      models: [],
    };
    save([...customProviders, next]);
    setEditing(id);
  };

  const removeProvider = (id: string) => {
    save(customProviders.filter((p) => p.id !== id));
    if (editing === id) setEditing(null);
  };

  const updateProvider = (id: string, patch: Partial<CustomProvider>) => {
    save(
      customProviders.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>Custom providers (OpenAI-compatible)</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Add any OpenAI-compatible endpoint. Models appear in the default
            model dropdown and autocomplete provider list.
          </span>
        </div>
      </div>

      {customProviders.map((cp) => (
        <CustomProviderCard
          key={cp.id}
          provider={cp}
          expanded={editing === cp.id}
          onToggle={() => setEditing(editing === cp.id ? null : cp.id)}
          onUpdate={(patch) => updateProvider(cp.id, patch)}
          onRemove={() => removeProvider(cp.id)}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={addProvider}
        className="h-8 gap-1.5 self-start text-[11.5px]"
      >
        <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
        Add provider
      </Button>
    </div>
  );
}

function CustomProviderCard({
  provider,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
}: {
  provider: CustomProvider;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<CustomProvider>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(provider.name);
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [apiKey, setApiKey] = useState(provider.apiKey);
  const [models, setModels] = useState(provider.models.join(", "));
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  useEffect(() => {
    setName(provider.name);
    setBaseURL(provider.baseURL);
    setApiKey(provider.apiKey);
    setModels(provider.models.join(", "));
  }, [provider]);

  const commitField = (
    field: keyof CustomProvider,
    value: string,
  ) => {
    if (field === "models") {
      const parsed = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (JSON.stringify(parsed) !== JSON.stringify(provider.models)) {
        onUpdate({ models: parsed });
      }
    } else {
      const trimmed = value.trim();
      if (trimmed !== provider[field]) {
        onUpdate({ [field]: trimmed });
      }
    }
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const url = baseURL.replace(/\/$/, "") + "/models";
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(url, { method: "GET", headers });
      if (res.ok) {
        setTestStatus("ok");
        const data = await res.json();
        if (data?.data && Array.isArray(data.data)) {
          const fetched = data.data
            .map((m: { id?: string }) => m.id)
            .filter(Boolean) as string[];
          if (fetched.length > 0 && !models.trim()) {
            setModels(fetched.join(", "));
            onUpdate({ models: fetched });
          }
        }
      } else {
        setTestStatus("fail");
      }
    } catch {
      setTestStatus("fail");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={LinkSquare01Icon} size={14} strokeWidth={1.75} className="text-muted-foreground" />
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left text-[12.5px] font-medium"
        >
          {provider.name || "Untitled provider"}
        </button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title="Remove"
          className="size-7 text-muted-foreground hover:text-destructive"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => commitField("name", name)}
              placeholder="e.g. Together AI"
              spellCheck={false}
              className="h-8 text-[11.5px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Base URL</Label>
            <Input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              onBlur={() => commitField("baseURL", baseURL)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>API key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => commitField("apiKey", apiKey)}
              placeholder="sk-… (optional for local servers)"
              autoComplete="off"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Models (comma-separated)</Label>
            <Input
              value={models}
              onChange={(e) => setModels(e.target.value)}
              onBlur={() => commitField("models", models)}
              placeholder="Leave blank — fetched on test connection"
              spellCheck={false}
              className="h-8 font-mono text-[11.5px]"
            />
            <span className="text-[10px] text-muted-foreground">
              Leave blank to auto-fetch all available models on test.
            </span>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void testConnection()}
              className="h-7 px-2.5 text-[11px]"
            >
              Test connection
            </Button>
            <Button
              size="sm"
              onClick={() => {
                commitField("name", name);
                commitField("baseURL", baseURL);
                commitField("apiKey", apiKey);
                commitField("models", models);
                setSaveStatus("saved");
                setTimeout(() => setSaveStatus("idle"), 1500);
              }}
              className="h-7 gap-1 px-2.5 text-[11px]"
            >
              Save
            </Button>
            {saveStatus === "saved" && (
              <span className="text-[10.5px] text-emerald-500">Saved</span>
            )}
            {testStatus === "ok" && (
              <span className="text-[10.5px] text-emerald-500">Connected</span>
            )}
            {testStatus === "fail" && (
              <span className="text-[10.5px] text-destructive">Failed to connect</span>
            )}
            {testStatus === "testing" && (
              <span className="text-[10.5px] text-muted-foreground">Testing…</span>
            )}
          </div>
        </div>
      )}
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
