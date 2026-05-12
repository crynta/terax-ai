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
  ArrowDown01Icon,
  ArrowUpIcon,
  ChatGptIcon,
  ClaudeIcon,
  ComputerIcon,
  CpuIcon,
  DeepseekIcon,
  FlashIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  Message01Icon,
  Mic01Icon,
  Search01Icon,
  StopCircleIcon,
  AiBookIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import {
  getModel,
  MODELS,
  providerNeedsKey,
  PROVIDERS,
  type ModelId,
  type ProviderId,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import { useChatStore } from "../store/chatStore";

const PROVIDER_ICON = {
  openai: ChatGptIcon,
  anthropic: ClaudeIcon,
  google: GoogleGeminiIcon,
  xai: Grok02Icon,
  cerebras: CpuIcon,
  groq: FlashIcon,
  deepseek: DeepseekIcon,
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

function ModelDropdown() {
  const selected = useChatStore((s) => s.selectedModelId);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setSelected = useChatStore((s) => s.setSelectedModelId);
  const current = getModel(selected);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProviderHasKey = providerNeedsKey(current.provider)
    ? !!apiKeys[current.provider]
    : true;

  // Searches based on label, hint and the provider
  const filteredModels = MODELS.filter((m) => {
    const q = search.toLowerCase();
    const matchesSearch = q === "" ||
      m.label.toLowerCase().includes(q) ||
      m.hint.toLowerCase().includes(q) ||
      m.provider.includes(q)

    const matchesProvider = activeProvider === null || m.provider === activeProvider;

    return matchesSearch && matchesProvider;
  });

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
              ? `Model: ${current.label}`
              : `${current.label} — no key configured`
          }
        >
          {current.label}
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
        className="w-100 p-0 overflow-hidden rounded-xl border border-border/70 shadow-xl"
        onFocusCapture={(e) => {
          if (e.target !== inputRef.current) {
            inputRef.current?.focus(); // focus issues related to Radix-UI
          }
        }}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2.5 border-b border-border/70 px-3 py-2.5">
          <HugeiconsIcon
            icon={Search01Icon}
            size={20}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground/70"
          />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()} // Radix-UI shifts focus when typing first latter
            placeholder="Search models..."
            className="bg-transparent text-sm outline-none"
          />
        </div>

        <div className="flex">
          {/* Provider sidebar */}
          <div className="flex w-10 overflow-y-auto flex-col border-r border-border/70">
            <Button
              variant={'ghost'}
              onClick={() => setActiveProvider(null)}
              title="All providers"
              className={cn(
                "relative transition-all",
                activeProvider === null
                  ? "text-foreground after:absolute after:bottom-1.5 after:right-0 after:top-1.5 after:w-0.75 after:rounded-full after:bg-primary after:content-['']"
                  : "text-muted-foreground/70",
              )}
            >
              <HugeiconsIcon
                icon={AiBookIcon}
                strokeWidth={1.5}
                className="opacity-70 size-5" // size dont work as its Button Component
              />
            </Button>

            {PROVIDERS.map((p) => {
              const hasKey = providerNeedsKey(p.id) ? !!apiKeys[p.id] : true;
              const isActive = activeProvider === p.id;
              return (
                <Button
                  variant={'ghost'}
                  key={p.id}
                  title={p.label}
                  onClick={() => setActiveProvider(p.id)}
                  className={cn(
                    "relative transition-all rounded-md",
                    isActive
                      ? "text-foreground after:absolute after:bottom-1.5 after:right-0 after:top-1.5 after:w-0.75 after:rounded-full after:bg-primary after:content-['']"
                      : hasKey
                        ? "text-muted-foreground/70"
                        : "text-amber-500/70",
                  )}
                >
                  <HugeiconsIcon
                    icon={PROVIDER_ICON[p.id]}
                    className="size-5"
                    strokeWidth={1.5}
                  />
                </Button>
              );
            })}
          </div>

          {/* Models list */}
          <div className="flex-1 overflow-y-auto max-h-95 py-1">
            {filteredModels.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-8 text-xs text-muted-foreground/70">
                No models found
              </div>
            ) : (
              filteredModels.map((m) => {
                const hasKey = providerNeedsKey(m.provider)
                  ? !!apiKeys[m.provider]
                  : true;
                const isSelected = m.id === selected;

                return (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={(e) => {
                      if (!hasKey) {
                        e.preventDefault();
                        void openSettingsWindow("models");
                        return;
                      }
                      setSelected(m.id as ModelId);
                    }}
                    className={cn(
                      "mx-1 flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-2.5 py-2",
                      isSelected
                        ? "bg-accent/60 text-foreground"
                        : "text-foreground/70",
                      !hasKey && "opacity-70",
                    )}
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <span className="font-medium leading-none">
                        {m.label}
                      </span>

                      {isSelected && (
                        <HugeiconsIcon
                          icon={Tick01Icon}
                          className="ml-auto"
                          size={16}
                          strokeWidth={1.5}
                        />
                      )}

                      {!hasKey && !isSelected && (
                        <Button
                          variant={'link'}
                          size={'sm'}
                          onClick={(e) => {
                            e.stopPropagation(); // it consider it as many clicks, resulting in settings window bug
                            openSettingsWindow("models");
                          }}
                          className="ml-auto text-xs p-0 text-amber-500"
                        >
                          Set key
                        </Button>
                      )}
                    </div>

                    <span className="text-[10px] leading-relaxed text-muted-foreground">
                      {m.hint}
                    </span>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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