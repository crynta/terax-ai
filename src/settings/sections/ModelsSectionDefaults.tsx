import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Refresh01Icon from "@hugeicons/core-free-icons/Refresh01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  getAutocompleteEligibleModels,
  getModel,
  getProvider,
  MODELS,
  type ModelId,
  PROVIDERS,
  type ProviderId,
  providerNeedsKey,
} from "@/modules/ai/config";
import {
  countHiddenPiProfileModels,
  countHiddenPiProviderModels,
  getPiModelProviderGroups,
  getPiProfileModelGroups,
} from "@/modules/pi/lib/model-options";
import { type PiProfileModelsList, piNative } from "@/modules/pi/lib/native";
import {
  isProfileModelSourceId,
  type PiProviderPrefs,
  profileModelSourceId,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAutocompleteEnabled,
  setAutocompleteModelId,
  setAutocompleteProvider,
  setDefaultModel,
  setPiAuthMode,
  setPiModelId,
} from "@/modules/settings/store";
import { ProviderIcon } from "../components/ProviderIcon";
import {
  FieldRow,
  isLocalProvider,
  type KeysMap,
  Label,
} from "./ModelsSectionShared";

export function DefaultsBlock({
  defaultModel,
  piProviderPrefs,
  configuredIds,
  keys,
}: {
  defaultModel: ModelId;
  piProviderPrefs: PiProviderPrefs;
  configuredIds: Set<ProviderId>;
  keys: KeysMap;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label>Defaults</Label>
      <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <FieldRow label="Chat model">
          <DefaultModelPicker
            defaultModel={defaultModel}
            configuredIds={configuredIds}
          />
        </FieldRow>
        <FieldRow label="Pi model">
          <PiModelPicker
            configuredIds={configuredIds}
            prefs={piProviderPrefs}
          />
        </FieldRow>
        <FieldRow label="Pi profile">
          {({ labelId }) => (
            <div
              className="flex flex-1 items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 px-2.5 py-2"
              aria-labelledby={labelId}
            >
              <div className="min-w-0">
                <p className="text-[11.5px] text-foreground">
                  Use existing Pi profile
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Uses terminal Pi auth/catalog. Terax model keys stay separate.
                </p>
              </div>
              <Switch
                aria-label="Use existing Pi profile"
                checked={piProviderPrefs.piAuthMode === "profile"}
                onCheckedChange={(checked) => {
                  void setPiAuthMode(checked ? "profile" : "terax");
                  if (
                    !checked &&
                    isProfileModelSourceId(piProviderPrefs.piModelId)
                  ) {
                    void setPiModelId(DEFAULT_MODEL_ID);
                  }
                }}
              />
            </div>
          )}
        </FieldRow>
        <AutocompleteRow keys={keys} configuredIds={configuredIds} />
      </div>
    </div>
  );
}

function DefaultModelPicker({
  defaultModel,
  configuredIds,
}: {
  defaultModel: ModelId;
  configuredIds: Set<ProviderId>;
}) {
  const [modelSearch, setModelSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const m = getModel(defaultModel);
  const modelQuery = modelSearch.trim();
  const modelFilters = useMemo(
    () => ({ query: modelQuery, showUnavailable }),
    [modelQuery, showUnavailable],
  );
  const providerGroups = getPiModelProviderGroups(configuredIds, modelFilters);
  const hiddenModelCount = countHiddenPiProviderModels(
    configuredIds,
    modelFilters,
  );
  const hasAny = MODELS.length > 0;
  const hasResults = providerGroups.length > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={!hasAny}
          className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
        >
          <span className="flex items-center gap-2 truncate">
            <ProviderIcon provider={m.provider} size={13} />
            <span className="truncate">{m.label}</span>
            <span className="text-muted-foreground">· {m.hint}</span>
          </span>
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-80 p-1"
      >
        <ModelSearchControls
          search={modelSearch}
          searchPlaceholder="Search chat models…"
          showUnavailable={showUnavailable}
          onSearchChange={setModelSearch}
          onShowUnavailableChange={setShowUnavailable}
        />
        <div className="max-h-72 overflow-y-auto overscroll-contain pr-1">
          {!hasResults ? (
            <DropdownMenuGroup>
              <DropdownMenuItem disabled className="text-[12px]">
                {modelQuery
                  ? hiddenModelCount > 0
                    ? "No matching usable chat models."
                    : "No matching chat models."
                  : "No usable chat models."}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {providerGroups.map((group) => (
            <div key={group.provider.id} className="px-1 pt-1.5 first:pt-1">
              <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <ProviderIcon provider={group.provider.id} size={11} />
                <span>{group.provider.label}</span>
                {group.setupRequired ? (
                  <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-muted-foreground normal-case">
                    Needs setup
                  </span>
                ) : null}
              </div>
              <DropdownMenuGroup>
                {group.models.map((mod) => (
                  <DropdownMenuItem
                    key={mod.id}
                    disabled={group.setupRequired}
                    onSelect={() => {
                      if (!group.setupRequired) {
                        void setDefaultModel(mod.id as ModelId);
                      }
                    }}
                    className={cn(
                      "flex items-start gap-2 text-[12px]",
                      mod.id === defaultModel && "bg-accent/50",
                    )}
                  >
                    <span className="flex flex-1 flex-col">
                      <span>{mod.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {group.setupRequired ? "Needs setup" : mod.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </div>
          ))}
          <HiddenModelsFooter count={hiddenModelCount} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelSearchControls({
  search,
  searchPlaceholder,
  showUnavailable,
  onSearchChange,
  onShowUnavailableChange,
}: {
  search: string;
  searchPlaceholder: string;
  showUnavailable: boolean;
  onSearchChange: (value: string) => void;
  onShowUnavailableChange: (value: boolean) => void;
}) {
  return (
    <div className="border-b border-border/50 p-1.5">
      <InputGroup className="h-8 rounded-lg bg-input/50">
        <InputGroupAddon align="inline-start" className="pl-2.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.8}
            className="text-muted-foreground"
          />
        </InputGroupAddon>
        <InputGroupInput
          name="model-search"
          autoComplete="off"
          aria-label={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder={searchPlaceholder}
          className="h-8 text-[11.5px]"
        />
      </InputGroup>
      <Field
        orientation="horizontal"
        className="mt-1.5 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40"
      >
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle className="text-[11px] font-medium text-foreground/85">
            Show unavailable
          </FieldTitle>
          <FieldDescription className="text-[10px] leading-tight">
            Reveal setup/auth-required models as disabled.
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Show unavailable models"
          size="sm"
          checked={showUnavailable}
          onCheckedChange={onShowUnavailableChange}
        />
      </Field>
    </div>
  );
}

function PiModelPicker({
  configuredIds,
  prefs,
}: {
  configuredIds: Set<ProviderId>;
  prefs: PiProviderPrefs;
}) {
  const [profileCatalog, setProfileCatalog] =
    useState<PiProfileModelsList | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const current = resolvePiProviderConfig(prefs);
  const modelQuery = modelSearch.trim();
  const modelFilters = useMemo(
    () => ({ query: modelQuery, showUnavailable }),
    [modelQuery, showUnavailable],
  );
  const isSearchingModels = modelQuery.length > 0;
  const providerGroups = getPiModelProviderGroups(configuredIds, modelFilters);
  const hiddenProviderModelCount = countHiddenPiProviderModels(
    configuredIds,
    modelFilters,
  );
  const customEndpointOptions = prefs.customEndpoints
    .filter((endpoint) => customEndpointMatchesSearch(endpoint, modelQuery))
    .map((endpoint) => ({ endpoint, ready: isCustomEndpointReady(endpoint) }));
  const visibleCustomEndpointOptions = showUnavailable
    ? customEndpointOptions
    : customEndpointOptions.filter((option) => option.ready);
  const hiddenCustomEndpointCount = showUnavailable
    ? 0
    : customEndpointOptions.filter((option) => !option.ready).length;
  const hiddenTeraxModelCount =
    hiddenProviderModelCount + hiddenCustomEndpointCount;
  const profileGroups = useMemo(
    () => getPiProfileModelGroups(profileCatalog, modelFilters),
    [modelFilters, profileCatalog],
  );
  const hiddenProfileModelCount = countHiddenPiProfileModels(
    profileCatalog,
    modelFilters,
  );
  const hasAny =
    prefs.piAuthMode === "profile"
      ? profileLoading ||
        profileCatalog === null ||
        profileCatalog.models.length > 0 ||
        !!profileError ||
        !!profileCatalog.loadError
      : MODELS.length > 0 || prefs.customEndpoints.length > 0;
  const hasTeraxResults =
    providerGroups.length > 0 || visibleCustomEndpointOptions.length > 0;
  const currentProvider = current.provider ?? "openai";

  const refreshProfileCatalog = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      setProfileCatalog(await piNative.modelsList());
    } catch (error: unknown) {
      setProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (prefs.piAuthMode !== "profile") return;
    void refreshProfileCatalog();
  }, [prefs.piAuthMode, refreshProfileCatalog]);

  const modeLabel =
    prefs.piAuthMode === "profile"
      ? current.ok
        ? current.providerLabel
        : "Choose profile model"
      : current.ok
        ? current.providerLabel
        : "Needs setup";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={!hasAny}
          className={cn(
            "h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]",
            !current.ok && "border-destructive/45",
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <ProviderIcon provider={currentProvider} size={13} />
            <span className="truncate">{current.modelLabel}</span>
            <span className="text-muted-foreground">· {modeLabel}</span>
          </span>
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        className="min-w-80 p-1"
      >
        <ModelSearchControls
          search={modelSearch}
          searchPlaceholder="Search Pi models…"
          showUnavailable={showUnavailable}
          onSearchChange={setModelSearch}
          onShowUnavailableChange={setShowUnavailable}
        />
        <div className="max-h-72 overflow-y-auto overscroll-contain pr-1">
          {prefs.piAuthMode === "profile" ? (
            <>
              <div className="px-1 pt-1.5 first:pt-1">
                <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  <ProviderIcon provider="openai-compatible" size={11} />
                  <span>Existing Pi profile</span>
                </div>
                {profileCatalog ? (
                  <p className="mb-1 truncate px-2 text-[10px] text-muted-foreground">
                    {profileCatalog.profileAgentDir}
                  </p>
                ) : null}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={profileLoading}
                    onSelect={(event) => {
                      event.preventDefault();
                      void refreshProfileCatalog();
                    }}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.8} />
                    {profileLoading
                      ? "Refreshing profile models…"
                      : "Refresh profile models"}
                  </DropdownMenuItem>
                  {profileLoading ? (
                    <DropdownMenuItem disabled className="text-[12px]">
                      Loading Pi profile models…
                    </DropdownMenuItem>
                  ) : null}
                  {profileError ? (
                    <DropdownMenuItem disabled className="text-[12px]">
                      {profileError}
                    </DropdownMenuItem>
                  ) : null}
                  {profileCatalog?.loadError ? (
                    <DropdownMenuItem disabled className="text-[12px]">
                      {profileCatalog.loadError}
                    </DropdownMenuItem>
                  ) : null}
                  {profileCatalog &&
                  !profileLoading &&
                  !profileError &&
                  !profileCatalog.loadError &&
                  profileCatalog.models.length === 0 ? (
                    <DropdownMenuItem disabled className="text-[12px]">
                      No Pi profile models found.
                    </DropdownMenuItem>
                  ) : null}
                  {profileCatalog &&
                  !profileLoading &&
                  !profileError &&
                  !profileCatalog.loadError &&
                  profileCatalog.models.length > 0 &&
                  profileGroups.length === 0 ? (
                    <DropdownMenuItem disabled className="text-[12px]">
                      {isSearchingModels
                        ? hiddenProfileModelCount > 0
                          ? "No matching usable Pi profile models."
                          : "No matching Pi profile models."
                        : "No usable Pi profile models."}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
              </div>
              {profileGroups.map((group) => (
                <div key={group.provider} className="px-1 pt-1.5 first:pt-1">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider={group.provider} size={11} />
                    <span>{group.providerLabel}</span>
                  </div>
                  <DropdownMenuGroup>
                    {group.models.map((model) => {
                      const id = profileModelSourceId(model.provider, model.id);
                      return (
                        <DropdownMenuItem
                          key={id}
                          disabled={!model.available}
                          onSelect={() => {
                            if (model.available) void setPiModelId(id);
                          }}
                          className={cn(
                            "flex items-start gap-2 text-[12px]",
                            id === prefs.piModelId && "bg-accent/50",
                          )}
                        >
                          <span className="flex flex-1 flex-col">
                            <span>{model.label}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {model.available
                                ? model.providerLabel
                                : "Needs auth in Pi profile"}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </div>
              ))}
              <HiddenModelsFooter count={hiddenProfileModelCount} />
            </>
          ) : (
            <>
              {!hasTeraxResults ? (
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled className="text-[12px]">
                    {isSearchingModels
                      ? hiddenTeraxModelCount > 0
                        ? "No matching usable Terax models."
                        : "No matching Terax models."
                      : "No usable Terax models."}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : null}
              {providerGroups.map((group) => (
                <div key={group.provider.id} className="px-1 pt-1.5 first:pt-1">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider={group.provider.id} size={11} />
                    <span>{group.provider.label}</span>
                    {group.setupRequired ? (
                      <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium tracking-normal text-muted-foreground normal-case">
                        Needs setup
                      </span>
                    ) : null}
                  </div>
                  <DropdownMenuGroup>
                    {group.models.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        disabled={group.setupRequired}
                        onSelect={() => {
                          if (!group.setupRequired) void setPiModelId(model.id);
                        }}
                        className={cn(
                          "flex items-start gap-2 text-[12px]",
                          model.id === prefs.piModelId && "bg-accent/50",
                        )}
                      >
                        <span className="flex flex-1 flex-col">
                          <span>{model.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.setupRequired
                              ? "Needs setup"
                              : model.description}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </div>
              ))}
              {visibleCustomEndpointOptions.length > 0 ? (
                <div className="px-1 pt-1.5 first:pt-1">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    <ProviderIcon provider="openai-compatible" size={11} />
                    <span>Custom endpoints</span>
                  </div>
                  <DropdownMenuGroup>
                    {visibleCustomEndpointOptions.map(({ endpoint, ready }) => {
                      const id = compatModelIdForEndpoint(endpoint.id);
                      return (
                        <DropdownMenuItem
                          key={endpoint.id}
                          disabled={!ready}
                          onSelect={() => {
                            if (ready) void setPiModelId(id);
                          }}
                          className={cn(
                            "flex items-start gap-2 text-[12px]",
                            id === prefs.piModelId && "bg-accent/50",
                          )}
                        >
                          <span className="flex flex-1 flex-col">
                            <span>
                              {endpoint.name.trim() ||
                                endpoint.modelId ||
                                "Custom endpoint"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {ready
                                ? endpoint.baseURL
                                : "Add a base URL and model id"}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </div>
              ) : null}
              <HiddenModelsFooter count={hiddenTeraxModelCount} />
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isCustomEndpointReady(endpoint: CustomEndpoint): boolean {
  return !!endpoint.baseURL.trim() && !!endpoint.modelId.trim();
}

function customEndpointMatchesSearch(
  endpoint: CustomEndpoint,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [endpoint.name, endpoint.baseURL, endpoint.modelId].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

function HiddenModelsFooter({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
        {hiddenModelsText(count)}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

function hiddenModelsText(count: number): string {
  return count === 1
    ? "1 unavailable model hidden"
    : `${count} unavailable models hidden`;
}

function AutocompleteRow({
  keys,
  configuredIds,
}: {
  keys: KeysMap;
  configuredIds: Set<ProviderId>;
}) {
  const enabled = usePreferencesStore((s) => s.autocompleteEnabled);
  const provider = usePreferencesStore((s) => s.autocompleteProvider);
  const modelId = usePreferencesStore((s) => s.autocompleteModelId);
  const eligible = useMemo(() => getAutocompleteEligibleModels(), []);

  // Fast cloud tiers + any configured local provider (one model id each).
  const items = useMemo(() => {
    const local = PROVIDERS.filter(
      (p) => isLocalProvider(p.id) && configuredIds.has(p.id),
    ).flatMap((p) => {
      const m = MODELS.find((x) => x.provider === p.id);
      return m ? [m] : [];
    });
    return [...eligible, ...local];
  }, [eligible, configuredIds]);

  const currentModel = useMemo(() => {
    if (isLocalProvider(provider)) {
      return MODELS.find((m) => m.provider === provider) ?? eligible[0];
    }
    return (
      MODELS.find((m) => m.provider === provider && m.id === modelId) ??
      MODELS.find((m) => m.id === modelId) ??
      eligible[0]
    );
  }, [eligible, provider, modelId]);

  const setModel = (id: string, providerId: ProviderId) => {
    void setAutocompleteProvider(providerId);
    void setAutocompleteModelId(isLocalProvider(providerId) ? "" : id);
  };

  const grouped = useMemo(() => {
    const map = new Map<ProviderId, (typeof items)[number][]>();
    for (const m of items) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return map;
  }, [items]);

  const hasKey = providerNeedsKey(provider) ? !!keys[provider] : true;

  return (
    <>
      <FieldRow label="Autocomplete">
        {({ labelId }) => (
          <div className="flex flex-1 items-center gap-2">
            <Switch
              aria-labelledby={labelId}
              checked={enabled}
              onCheckedChange={(v) => void setAutocompleteEnabled(v)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Choose autocomplete model"
                  variant="outline"
                  disabled={!enabled}
                  className="h-8 flex-1 justify-between gap-2 px-2.5 text-[11.5px]"
                >
                  <span className="flex items-center gap-2 truncate">
                    <ProviderIcon provider={currentModel.provider} size={12} />
                    <span className="truncate">{currentModel.label}</span>
                    <span className="text-muted-foreground">
                      · {currentModel.hint}
                    </span>
                  </span>
                  <HugeiconsIcon
                    data-icon="inline-start"
                    icon={ArrowDown01Icon}
                    strokeWidth={2}
                    className="opacity-70"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                collisionPadding={12}
                className="max-h-72 min-w-70 overflow-y-auto"
              >
                {PROVIDERS.map((p) => {
                  const list = grouped.get(p.id);
                  if (!list || list.length === 0) return null;
                  const pConfigured = configuredIds.has(p.id);
                  return (
                    <div key={p.id} className="px-1 pt-1.5 first:pt-1">
                      <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        <ProviderIcon provider={p.id} size={11} />
                        <span>{p.label}</span>
                        {!pConfigured ? (
                          <span className="ml-auto text-[9.5px] normal-case tracking-normal text-muted-foreground/70">
                            not connected
                          </span>
                        ) : null}
                      </div>
                      <DropdownMenuGroup>
                        {list.map((m) => (
                          <DropdownMenuItem
                            key={m.id}
                            disabled={!pConfigured}
                            onSelect={() => pConfigured && setModel(m.id, p.id)}
                            className={cn(
                              "text-[11.5px]",
                              m.id === modelId && "bg-accent/50",
                            )}
                          >
                            <span className="flex flex-col">
                              <span>{m.label}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {m.description}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </div>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </FieldRow>
      {enabled && !hasKey ? (
        <p className="pl-19 text-[10.5px] text-muted-foreground">
          {getProvider(provider).label} isn't connected. Add it below.
        </p>
      ) : null}
    </>
  );
}
