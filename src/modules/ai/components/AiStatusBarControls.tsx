import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  Add01Icon,
  AiBookIcon,
  ArrowDown01Icon,
  ArrowUpIcon,
  BrainIcon,
  ChatGptIcon,
  ClaudeIcon,
  Clock01Icon,
  CoinsDollarIcon,
  ComputerIcon,
  CpuIcon,
  CampfireIcon,
  DashboardSpeed01Icon,
  DatabaseIcon,
  DeepseekIcon,
  FavouriteIcon,
  FireworksIcon,
  FlashIcon,
  GlobeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  Hexagon01Icon,
  Message01Icon,
  Mic01Icon,
  Moon02Icon,
  NeuralNetworkIcon,
  Package01Icon,
  PlugIcon,
  Rocket01Icon,
  Search01Icon,
  ServerStack01Icon,
  SparklesIcon,
  Settings01Icon,
  SquareIcon,
  StarIcon,
  StopCircleIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  getModel,
  MODELS,
  providerNeedsKey,
  PROVIDERS,
  type ModelCapabilities,
  type ModelId,
  type ModelInfo,
  type ProviderId,
} from "../config";
import { fetchProviderModels, type RemoteModel } from "../lib/fetchModels";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";

const PROVIDER_ICON = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: GlobeIcon,
  openrouter: GlobeIcon,
  together: Rocket01Icon,
  fireworks: FireworksIcon,
  perplexity: Search01Icon,
  cohere: DatabaseIcon,
  moonshot: Moon02Icon,
  siliconflow: SparklesIcon,
  hyperbolic: Hexagon01Icon,
  deepinfra: NeuralNetworkIcon,
  novita: CampfireIcon,
  ai21: GlobeIcon,
  huggingface: Package01Icon,
  sambanova: BrainIcon,
  minimax: SquareIcon,
  zhipu: StarIcon,
  volcengine: DashboardSpeed01Icon,
  yi: AiBookIcon,
  replicate: FlashIcon,
  ollama: ServerStack01Icon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

export function AiOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <motion.button
      initial={{ y: -15 }}
      animate={{ y: 0 }}
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-xs",
        "text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground",
      )}
      title="Open AI agent"
    >
      <span>Open AI agent</span>
      <Kbd className="h-4 min-w-4 px-1">{fmtShortcut(MOD_KEY, "I")}</Kbd>
    </motion.button>
  );
}

export function AiStatusBarControls() {
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openMini = useChatStore((s) => s.openMini);
  const miniOpen = useChatStore((s) => s.mini.open);
  const closePanel = useChatStore((s) => s.closePanel);

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title="Attach file or image"
        onClick={() => fileInputRef.current?.click()}
        disabled={c.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {c.voice.supported && (
        <IconBtn
          title={
            !c.voice.hasKey
              ? "Voice needs an OpenAI key"
              : c.voice.recording
                ? "Stop & transcribe"
                : c.voice.transcribing
                  ? "Transcribing…"
                  : "Voice input"
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
          className={cn(
            c.voice.recording &&
            "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}

      <ModelDropdown />

      <span className="mx-1 h-8 w-px bg-border" aria-hidden />
      <Button
        onClick={closePanel}
        title="Close AI panel"
        size="xs"
        variant="ghost"
        aria-label="Close AI panel"
        className="text-[11px] text-foreground/85 px-1"
      >
        <Kbd className="h-4 gap-px px-2 font-mono text-[11px]">
          {fmtShortcut(MOD_KEY, "I")}
        </Kbd>
      </Button>
      <IconBtn
        title={miniOpen ? "Mini-window open" : "Open conversation"}
        onClick={openMini}
        disabled={miniOpen}
      >
        <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
      </IconBtn>

      {c.isBusy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={c.stop}
          className="size-6"
          aria-label="Stop"
          title="Stop"
        >
          <HugeiconsIcon icon={StopCircleIcon} size={13} strokeWidth={1.75} />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={c.submit}
          disabled={!c.canSend}
          className="h-5.5 w-7.5 ml-1"
          aria-label="Send"
          title="Send (Enter)"
        >
          <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}

type Tab = "all" | "favorites" | "recent";

function ModelDropdown() {
  const selected = useChatStore((s) => s.selectedModelId);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const selectRemote = useChatStore((s) => s.selectRemoteModel);
  const remoteOverride = useChatStore((s) => s.remoteModelOverride);
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const current = getModel(selected);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [remoteModels, setRemoteModels] = useState<Map<ProviderId, RemoteModel[]>>(new Map());
  const [remoteLoading, setRemoteLoading] = useState<Set<ProviderId>>(new Set());
  const [remoteError, setRemoteError] = useState<Map<ProviderId, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProviderHasKey = providerNeedsKey(current.provider)
    ? !!apiKeys[current.provider]
    : true;

  const hasKeyFor = (id: ProviderId) =>
    providerNeedsKey(id) ? !!apiKeys[id] : true;

  const loadRemoteModels = async (providerId: ProviderId) => {
    setRemoteLoading((prev) => new Set(prev).add(providerId));
    setRemoteError((prev) => {
      const next = new Map(prev);
      next.delete(providerId);
      return next;
    });
    const result = await fetchProviderModels(providerId, apiKeys[providerId]);
    setRemoteLoading((prev) => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
    if (result.error) {
      setRemoteError((prev) => new Map(prev).set(providerId, result.error!));
    } else {
      setRemoteModels((prev) => new Map(prev).set(providerId, result.models));
    }
  };

  const sortedProviders = useMemo(() => {
    const configured: (typeof PROVIDERS)[number][] = [];
    const unconfigured: (typeof PROVIDERS)[number][] = [];
    for (const p of PROVIDERS) {
      (hasKeyFor(p.id) ? configured : unconfigured).push(p);
    }
    return { configured, unconfigured };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool: readonly ModelInfo[] = MODELS;
    if (tab === "favorites") {
      pool = pool.filter((m) => favoriteIds.includes(m.id));
    } else if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      pool = pool
        .filter((m) => order.has(m.id))
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    pool = pool.filter((m) => hasKeyFor(m.provider));
    if (activeProvider !== null) {
      pool = pool.filter((m) => m.provider === activeProvider);
    }
    if (q) {
      pool = pool.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.hint.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.provider.includes(q) ||
          (m.tags?.some((t) => t.includes(q)) ?? false),
      );
    }
    return pool;
  }, [activeProvider, favoriteIds, recentIds, search, tab]);

  const remoteFiltered = useMemo(() => {
    if (activeProvider === null) return [];
    const models = remoteModels.get(activeProvider);
    if (!models) return [];
    const q = search.trim().toLowerCase();
    const staticIds = new Set<string>(
      MODELS.filter((m) => m.provider === activeProvider).map((m) => m.id),
    );
    const deduped = models.filter((m) => !staticIds.has(m.id));
    if (!q) return deduped;
    return deduped.filter((m) => m.id.toLowerCase().includes(q));
  }, [activeProvider, remoteModels, search]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-5.5 gap-1 rounded-md px-1.5 my-1 text-xs hover:bg-accent hover:text-foreground",
            currentProviderHasKey
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
          title={
            currentProviderHasKey
              ? `Model: ${remoteOverride ?? current.label}`
              : `${current.label} — no key configured`
          }
        >
          {remoteOverride ?? current.label}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-[28rem] p-0 overflow-hidden rounded-xl border border-border/70 shadow-xl"
        onFocusCapture={(e) => {
          if (e.target !== inputRef.current) inputRef.current?.focus();
        }}
      >
        {/* Search */}
        <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground/70"
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Search models, providers, capabilities…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 border-b border-border/70 px-2 py-1.5">
          <TabButton
            label="All"
            icon={AiBookIcon}
            active={tab === "all"}
            onClick={() => setTab("all")}
          />
          <TabButton
            label="Favorites"
            icon={FavouriteIcon}
            active={tab === "favorites"}
            onClick={() => setTab("favorites")}
            count={favoriteIds.length || undefined}
          />
          <TabButton
            label="Recent"
            icon={Clock01Icon}
            active={tab === "recent"}
            onClick={() => setTab("recent")}
            count={recentIds.length || undefined}
          />
        </div>

        <div className="flex">
          {/* Provider sidebar — only show configured + keyless providers. */}
          <div className="flex w-11 flex-col gap-0.5 border-r border-border/70 bg-muted/20 py-1.5">
            <ProviderPill
              icon={AiBookIcon}
              title="All providers"
              active={activeProvider === null}
              onClick={() => setActiveProvider(null)}
            />
            {sortedProviders.configured.map((p) => (
              <ProviderPill
                key={p.id}
                icon={PROVIDER_ICON[p.id]}
                title={p.label}
                active={activeProvider === p.id}
                onClick={() => setActiveProvider(p.id)}
              />
            ))}
          </div>

          {/* Models list */}
          <div className="flex-1 overflow-y-auto py-1 max-h-[22rem]">
            {activeProvider !== null ? (
              <ProviderHeader
                providerId={activeProvider}
                remoteModels={remoteModels.get(activeProvider)}
                remoteLoading={remoteLoading.has(activeProvider)}
                remoteError={remoteError.get(activeProvider)}
                onRefresh={() => void loadRemoteModels(activeProvider)}
              />
            ) : null}
            {activeProvider !== null && !hasKeyFor(activeProvider) ? (
              <ProviderConfigureCTA providerId={activeProvider} />
            ) : null}
            {filtered.length === 0 && remoteFiltered.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-10 text-xs text-muted-foreground/70">
                {tab === "favorites"
                  ? "No favorites yet — star a model to pin it here."
                  : tab === "recent"
                    ? "No recently-used models."
                    : "No models match."}
              </div>
            ) : (
              <>
                {filtered.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    selected={!remoteOverride && m.id === selected}
                    hasKey={hasKeyFor(m.provider)}
                    favorite={favoriteIds.includes(m.id)}
                    showProviderIcon={activeProvider === null}
                    onPick={() => {
                      if (!hasKeyFor(m.provider)) {
                        void openSettingsWindow("models");
                        return;
                      }
                      setSelected(m.id as ModelId);
                    }}
                    onToggleFavorite={() => void toggleFavoriteModel(m.id)}
                  />
                ))}
                {remoteFiltered.length > 0 ? (
                  <>
                    <div className="mx-3 my-1 border-t border-border/40" />
                    <div className="px-3 pb-1 pt-0.5 text-[10px] text-muted-foreground/50">
                      Remote models ({remoteFiltered.length})
                    </div>
                    {remoteFiltered.map((rm) => (
                      <RemoteModelRow
                        key={rm.id}
                        modelId={rm.id}
                        ownedBy={rm.owned_by}
                        providerId={activeProvider!}
                        selected={remoteOverride === rm.id}
                        onPick={() => {
                          const carrier = MODELS.find(
                            (m) => m.provider === activeProvider,
                          );
                          if (carrier) {
                            selectRemote(carrier.id as ModelId, rm.id);
                          }
                        }}
                      />
                    ))}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: typeof AiBookIcon;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
      {label}
      {count != null ? (
        <span className="rounded-full bg-muted/60 px-1.5 text-[9.5px] tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ProviderPill({
  icon,
  title,
  active,
  muted,
  onClick,
}: {
  icon: typeof AiBookIcon;
  title: string;
  active: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative mx-auto flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-accent text-foreground after:absolute after:right-0 after:top-1.5 after:bottom-1.5 after:w-[2px] after:rounded-full after:bg-primary after:content-['']"
          : muted
            ? "text-muted-foreground/50 hover:bg-accent/40 hover:text-foreground"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
    </button>
  );
}

function ProviderHeader({
  providerId,
  remoteModels,
  remoteLoading,
  remoteError,
  onRefresh,
}: {
  providerId: ProviderId;
  remoteModels?: RemoteModel[];
  remoteLoading?: boolean;
  remoteError?: string;
  onRefresh: () => void;
}) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  const canFetch = p.modelsUrl !== null;
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
      <HugeiconsIcon
        icon={PROVIDER_ICON[p.id]}
        size={13}
        strokeWidth={1.75}
      />
      <span>{p.label}</span>
      {canFetch ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={remoteLoading}
          className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground"
          title="Fetch available models from API"
        >
          {remoteLoading ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} strokeWidth={2} />
          )}
          {remoteModels
            ? `${remoteModels.length} models`
            : "Fetch models"}
        </button>
      ) : null}
      {remoteError ? (
        <span className="ml-1 truncate text-[10px] text-destructive/70" title={remoteError}>
          error
        </span>
      ) : null}
    </div>
  );
}

function ProviderConfigureCTA({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <button
      type="button"
      onClick={() => void openSettingsWindow("models")}
      className="group mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent/40 hover:text-foreground"
    >
      <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} />
      <span className="flex-1 truncate">
        Configure {p.label} to use these models.
      </span>
      <span className="shrink-0 text-[10px] underline-offset-2 group-hover:underline">
        Open
      </span>
    </button>
  );
}

function ModelRow({
  model,
  selected,
  hasKey,
  favorite,
  showProviderIcon,
  onPick,
  onToggleFavorite,
}: {
  model: ModelInfo;
  selected: boolean;
  hasKey: boolean;
  favorite: boolean;
  showProviderIcon: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "group mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-accent/60 text-foreground" : "text-foreground/85",
        !hasKey && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite();
        }}
        title={favorite ? "Unfavorite" : "Favorite"}
        className={cn(
          "shrink-0 rounded p-0.5 transition-colors",
          favorite
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-amber-500",
        )}
      >
        <HugeiconsIcon
          icon={StarIcon}
          size={12}
          strokeWidth={favorite ? 2 : 1.75}
          className={favorite ? "fill-amber-500" : ""}
        />
      </button>

      {showProviderIcon ? (
        <HugeiconsIcon
          icon={PROVIDER_ICON[model.provider]}
          size={13}
          strokeWidth={1.5}
          className="shrink-0 text-muted-foreground/70"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 text-[12px] font-medium leading-none">
          {model.label}
        </span>
        <span className="truncate text-[10.5px] leading-none text-muted-foreground">
          {model.description}
        </span>
      </div>

      <CapabilityBars caps={model.capabilities} />

      {selected ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

function RemoteModelRow({
  modelId,
  ownedBy,
  providerId,
  selected,
  onPick,
}: {
  modelId: string;
  ownedBy: string;
  providerId: ProviderId;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "group mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
        selected ? "bg-accent/60 text-foreground" : "text-foreground/70",
      )}
    >
      <HugeiconsIcon
        icon={PROVIDER_ICON[providerId]}
        size={13}
        strokeWidth={1.5}
        className="shrink-0 text-muted-foreground/50"
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] font-medium leading-none">
          {modelId}
        </span>
        {ownedBy ? (
          <span className="truncate text-[10px] leading-none text-muted-foreground/50">
            {ownedBy}
          </span>
        ) : null}
      </div>
      {selected ? (
        <HugeiconsIcon
          icon={Tick01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-foreground"
        />
      ) : null}
    </DropdownMenuItem>
  );
}

function CapabilityBars({ caps }: { caps: ModelCapabilities }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <CapBar icon={BrainIcon} value={caps.intelligence} label="Intelligence" />
      <CapBar icon={FlashIcon} value={caps.speed} label="Speed" />
      <CapBar
        icon={CoinsDollarIcon}
        value={caps.cost}
        label="Affordability"
      />
    </div>
  );
}

function CapBar({
  icon,
  value,
  label,
}: {
  icon: typeof AiBookIcon;
  value: number;
  label: string;
}) {
  return (
    <span
      className="flex items-center gap-0.5"
      title={`${label}: ${value}/5`}
    >
      <HugeiconsIcon
        icon={icon}
        size={10}
        strokeWidth={1.75}
        className="text-muted-foreground/60"
      />
      <span className="flex items-center gap-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-[2px] rounded-full",
              i <= value ? "bg-foreground/70" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-6 rounded-md text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}