import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import AiBookIcon from "@hugeicons/core-free-icons/AiBookIcon";
import AppleIcon from "@hugeicons/core-free-icons/AppleIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowUpIcon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import ChatGptIcon from "@hugeicons/core-free-icons/ChatGptIcon";
import ClaudeIcon from "@hugeicons/core-free-icons/ClaudeIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CoinsDollarIcon from "@hugeicons/core-free-icons/CoinsDollarIcon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import CpuIcon from "@hugeicons/core-free-icons/CpuIcon";
import DeepseekIcon from "@hugeicons/core-free-icons/DeepseekIcon";
import FavouriteIcon from "@hugeicons/core-free-icons/FavouriteIcon";
import FlashIcon from "@hugeicons/core-free-icons/FlashIcon";
import GlobeIcon from "@hugeicons/core-free-icons/GlobeIcon";
import GoogleGeminiIcon from "@hugeicons/core-free-icons/GoogleGeminiIcon";
import Grok02Icon from "@hugeicons/core-free-icons/Grok02Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon";
import MistralIcon from "@hugeicons/core-free-icons/MistralIcon";
import PlugIcon from "@hugeicons/core-free-icons/Plug01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import ServerStack01Icon from "@hugeicons/core-free-icons/ServerStack01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
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
import { statusTextClass } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  compatModelIdForEndpoint,
  getCompatModelInfo,
  getModel,
  isCompatModelId,
  MODELS,
  type ModelCapabilities,
  type ModelId,
  type ModelInfo,
  PROVIDERS,
  type ProviderId,
  providerNeedsKey,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { isModelSelectable } from "../lib/mockFlags";
import { toggleFavoriteModel } from "../lib/modelPrefs";
import { useChatStore } from "../store/chatStore";

const PROVIDER_ICON = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
  mistral: MistralIcon,
  openrouter: GlobeIcon,
  "openai-compatible": PlugIcon,
  lmstudio: ComputerIcon,
  mlx: AppleIcon,
  ollama: ServerStack01Icon,
} as const satisfies Record<ProviderId, typeof ChatGptIcon>;

export function AiOpenButton({ onOpen }: { onOpen: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
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

type AiStatusBarControlsProps = {
  conversationOpen?: boolean;
  onOpenConversation?: () => void;
};

export function AiStatusBarControls({
  conversationOpen,
  onOpenConversation,
}: AiStatusBarControlsProps = {}) {
  const c = useComposer();
  const { actions, meta, state } = c;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openMini = useChatStore((s) => s.openMini);
  const miniOpen = useChatStore((s) => s.mini.open);
  const closePanel = useChatStore((s) => s.closePanel);
  const openConversation = onOpenConversation ?? openMini;
  const isConversationOpen = conversationOpen ?? miniOpen;

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void actions.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <IconBtn
        title="Attach file or image"
        onClick={() => fileInputRef.current?.click()}
        disabled={state.isBusy}
      >
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
      </IconBtn>

      {meta.voice.supported && (
        <IconBtn
          title={
            !meta.voice.hasKey
              ? "Voice needs an OpenAI key"
              : meta.voice.recording
                ? "Stop & transcribe"
                : meta.voice.transcribing
                  ? "Transcribing…"
                  : "Voice input"
          }
          onClick={() =>
            meta.voice.recording ? meta.voice.stop() : void meta.voice.start()
          }
          disabled={
            state.isBusy || meta.voice.transcribing || !meta.voice.hasKey
          }
          className={cn(
            meta.voice.recording &&
              "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {meta.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : meta.voice.transcribing ? (
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
        title={isConversationOpen ? "Conversation open" : "Open conversation"}
        onClick={openConversation}
        disabled={isConversationOpen}
      >
        <HugeiconsIcon icon={Message01Icon} size={13} strokeWidth={1.75} />
      </IconBtn>

      {state.isBusy ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={actions.stop}
          className="size-6"
          aria-label="Stop"
          title="Stop"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={StopCircleIcon}
            strokeWidth={1.75}
          />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={actions.submit}
          disabled={!state.canSend}
          className="h-5.5 w-7.5 ml-1"
          aria-label="Send"
          title="Send (Enter)"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowUpIcon}
            strokeWidth={1.75}
          />
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
  const favoriteIds = usePreferencesStore((s) => s.favoriteModelIds);
  const recentIds = usePreferencesStore((s) => s.recentModelIds);
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const current = isCompatModelId(selected)
    ? getCompatModelInfo(selected, customEndpoints)
    : getModel(selected as ModelId);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProviderHasKey = isCompatModelId(selected)
    ? true
    : providerNeedsKey(current.provider)
      ? !!apiKeys[current.provider]
      : true;

  const hasKeyFor = (id: ProviderId) =>
    providerNeedsKey(id) ? !!apiKeys[id] : true;

  const epModelInfos = useMemo(() => {
    return customEndpoints.map((ep) =>
      getCompatModelInfo(compatModelIdForEndpoint(ep.id), customEndpoints),
    );
  }, [customEndpoints]);

  const sortedProviders = useMemo(() => {
    const configured: (typeof PROVIDERS)[number][] = [];
    const unconfigured: (typeof PROVIDERS)[number][] = [];
    for (const p of PROVIDERS) {
      if (p.id === "openai-compatible") continue;
      (hasKeyFor(p.id) ? configured : unconfigured).push(p);
    }
    return { configured, unconfigured };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeys]);

  const allModels = useMemo(
    () => [...MODELS.filter((m) => isModelSelectable(m.id)), ...epModelInfos],
    [epModelInfos],
  );

  const COMPAT_PROVIDER_ID = "__compat__";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let pool: readonly ModelInfo[] = allModels;
    if (tab === "favorites") {
      pool = pool.filter((m) => favoriteIds.includes(m.id));
    } else if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      pool = pool
        .filter((m) => order.has(m.id))
        .slice()
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (activeProvider === COMPAT_PROVIDER_ID) {
      pool = pool.filter((m) => isCompatModelId(m.id));
    } else if (activeProvider !== null) {
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
  }, [activeProvider, allModels, favoriteIds, recentIds, search, tab]);

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
              : statusTextClass("warning"),
          )}
          title={
            currentProviderHasKey
              ? `Model: ${current.label}`
              : `${current.label} - no key configured`
          }
        >
          {current.label}
          <HugeiconsIcon
            data-icon="inline-start"
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
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
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
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

        <div className="flex max-h-104 min-h-0">
          {/* Provider sidebar: configured first, unconfigured muted, no dividers. */}
          <div className="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 bg-muted/20 py-1.5">
            <ProviderPill
              icon={AiBookIcon}
              title="All providers"
              active={activeProvider === null}
              onClick={() => setActiveProvider(null)}
            />
            {[
              ...sortedProviders.configured,
              ...sortedProviders.unconfigured,
            ].map((p) => (
              <ProviderPill
                key={p.id}
                icon={PROVIDER_ICON[p.id]}
                title={
                  hasKeyFor(p.id) ? p.label : `${p.label} - not configured`
                }
                active={activeProvider === p.id}
                muted={!hasKeyFor(p.id)}
                onClick={() => setActiveProvider(p.id)}
              />
            ))}
            {customEndpoints.length > 0 && (
              <ProviderPill
                icon={PlugIcon}
                title="OpenAI Compatible"
                active={activeProvider === COMPAT_PROVIDER_ID}
                onClick={() => setActiveProvider(COMPAT_PROVIDER_ID)}
              />
            )}
          </div>

          {/* Models list */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {activeProvider === COMPAT_PROVIDER_ID && (
              <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
                <HugeiconsIcon icon={PlugIcon} size={13} strokeWidth={1.75} />
                <span>OpenAI Compatible</span>
              </div>
            )}
            {activeProvider !== null &&
            activeProvider !== COMPAT_PROVIDER_ID ? (
              <ProviderHeader providerId={activeProvider as ProviderId} />
            ) : null}
            {activeProvider !== null &&
            activeProvider !== COMPAT_PROVIDER_ID &&
            !hasKeyFor(activeProvider as ProviderId) ? (
              <ProviderConfigureCTA providerId={activeProvider as ProviderId} />
            ) : null}
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-10 text-xs text-muted-foreground/70">
                {tab === "favorites"
                  ? "No favorites yet. Star a model to pin it here."
                  : tab === "recent"
                    ? "No recently-used models."
                    : "No models match."}
              </div>
            ) : (
              filtered.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  selected={m.id === selected}
                  hasKey={isCompatModelId(m.id) || hasKeyFor(m.provider)}
                  favorite={favoriteIds.includes(m.id)}
                  showProviderIcon={activeProvider === null}
                  onPick={() => {
                    if (!isCompatModelId(m.id) && !hasKeyFor(m.provider)) {
                      void openSettingsWindow("models");
                      return;
                    }
                    setSelected(m.id);
                  }}
                  onToggleFavorite={() => void toggleFavoriteModel(m.id)}
                />
              ))
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
      aria-pressed={active}
      className={cn(
        "flex min-h-7 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
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
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative mx-auto flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
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

function ProviderHeader({ providerId }: { providerId: ProviderId }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-tight text-muted-foreground/90">
      <HugeiconsIcon icon={PROVIDER_ICON[p.id]} size={13} strokeWidth={1.75} />
      <span>{p.label}</span>
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
        aria-label={
          favorite ? `Unfavorite ${model.label}` : `Favorite ${model.label}`
        }
        title={favorite ? "Unfavorite" : "Favorite"}
        className={cn(
          "shrink-0 rounded p-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
          favorite
            ? "text-primary"
            : "text-muted-foreground/40 hover:text-primary",
        )}
      >
        <HugeiconsIcon
          icon={StarIcon}
          strokeWidth={favorite ? 2 : 1.75}
          className={cn(favorite && "fill-primary")}
        />
      </button>

      {showProviderIcon ? (
        <HugeiconsIcon
          icon={PROVIDER_ICON[model.provider]}
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
      <CapBar icon={CoinsDollarIcon} value={caps.cost} label="Affordability" />
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
    <span className="flex items-center gap-0.5" title={`${label}: ${value}/5`}>
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
      aria-label={title}
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
