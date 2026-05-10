import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { MOD_KEY } from "@/lib/platform";
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
  FlashIcon,
  Globe02Icon,
  GoogleGeminiIcon,
  Grok02Icon,
  Message01Icon,
  Mic01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { useRef } from "react";
import {
  getModel,
  MODELS,
  PROVIDERS,
  providerNeedsKey,
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
  lmstudio: ComputerIcon,
  "openai-compatible": Globe02Icon,
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
      <Kbd className="h-4 min-w-4 px-1">{MOD_KEY}I</Kbd>
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
      {/* <Button
        onClick={closePanel}
        title="Close AI panel"
        size="xs"
        variant="outline"
        aria-label="Close AI panel"
        className="text-[11px] text-foreground/85 pl-1.5"
      > */}
      {/* <Kbd className="h-4 gap-px text-[11px]">
          ⌘<span className="font-mono">I</span>
        </Kbd> */}
      {/* Close */}
      {/* </Button> */}
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
        <Kbd className="h-4 gap-px text-[11px]">
          {MOD_KEY}<span className="font-mono">I</span>
        </Kbd>
        {/* <HugeiconsIcon icon={Close} size={15} strokeWidth={1.75} /> */}
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
  const currentProviderHasKey =
    !providerNeedsKey(current.provider) || !!apiKeys[current.provider];

  const onPick = (id: ModelId, providerId: ProviderId) => {
    if (providerNeedsKey(providerId) && !apiKeys[providerId]) {
      void openSettingsWindow("models");
      return;
    }
    setSelected(id);
  };

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
          {/* <HugeiconsIcon
            icon={PROVIDER_ICON[current.provider]}
            size={12}
            strokeWidth={1.25}
          /> */}
          {current.label}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={11}
            strokeWidth={2}
            className="opacity-70"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        {PROVIDERS.map((p) => {
          const models = MODELS.filter((m) => m.provider === p.id);
          if (models.length === 0) return null;
          const hasKey = !providerNeedsKey(p.id) || !!apiKeys[p.id];
          return (
            <div key={p.id} className="px-1 pt-1.5 first:pt-1">
              <div className="mb-0.5 flex items-center gap-1.5 px-2 text-[9.5px] font-medium tracking-wide text-muted-foreground uppercase">
                <HugeiconsIcon
                  icon={PROVIDER_ICON[p.id]}
                  size={15}
                  strokeWidth={1.25}
                />
                <span>{p.label}</span>
                {providerNeedsKey(p.id) && !hasKey ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void openSettingsWindow("models");
                    }}
                    className="ml-auto rounded-sm px-1 text-[9px] normal-case tracking-normal text-amber-600 underline-offset-2 hover:underline dark:text-amber-400"
                  >
                    Set key…
                  </button>
                ) : null}
              </div>
              {models.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  disabled={!hasKey}
                  onSelect={() => onPick(m.id as ModelId, p.id)}
                  className={cn(
                    "flex flex-col items-start gap-0 text-xs",
                    m.id === selected && "bg-accent/40",
                  )}
                >
                  <span className="font-medium">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {m.hint}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
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
