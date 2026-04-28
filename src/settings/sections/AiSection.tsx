import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  MODELS,
  PROVIDERS,
  getModel,
  type ModelId,
  type ProviderId,
} from "@/modules/ai/config";
import { clearKey, getAllKeys, setKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  emitKeysChanged,
  setCustomInstructions,
  setDefaultModel,
} from "@/modules/settings/store";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "../components/ProviderIcon";
import { ProviderKeyCard } from "../components/ProviderKeyCard";
import { SectionHeader } from "../components/SectionHeader";

type KeysMap = Record<ProviderId, string | null>;

export function AiSection() {
  const [keys, setKeys] = useState<KeysMap | null>(null);
  const defaultModel = usePreferencesStore((s) => s.defaultModelId);
  const customInstructions = usePreferencesStore((s) => s.customInstructions);

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

  const defaultModelInfo = getModel(defaultModel);

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="AI"
        description="Bring your own keys. They are stored in your OS keychain and used only by Terax."
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
          <DropdownMenuContent align="start" className="min-w-[260px]">
            {PROVIDERS.map((p) => {
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2">
        <Label>API keys</Label>
        <div className="flex flex-col gap-2">
          {PROVIDERS.map((p) => (
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

      <CustomInstructionsBlock value={customInstructions} />
    </div>
  );
}

function CustomInstructionsBlock({ value }: { value: string }) {
  const [draft, setDraft] = useState(value);
  const [savedTick, setSavedTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadFirstSync = useRef(false);

  // Sync external changes (cross-window updates) into the textarea, but only
  // when the local draft is up to date — don't clobber typing.
  useEffect(() => {
    if (!hadFirstSync.current) {
      hadFirstSync.current = true;
      setDraft(value);
      return;
    }
  }, [value]);

  const queueSave = (next: string) => {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void setCustomInstructions(next).then(() => {
        setSavedTick((n) => n + 1);
      });
    }, 350);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Custom instructions</Label>
        {savedTick > 0 ? (
          <span className="text-[10px] text-muted-foreground">Saved</span>
        ) : null}
      </div>
      <Textarea
        value={draft}
        onChange={(e) => queueSave(e.target.value)}
        placeholder="e.g. Always reply in concise bullet points. Prefer pnpm over npm. My machine is an M-series Mac."
        className="min-h-[120px] resize-y bg-card/60 font-sans text-[12px] leading-relaxed"
      />
      <p className="text-[10.5px] text-muted-foreground">
        Appended to the system prompt for every conversation, after Terax's core
        rules.
      </p>
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
