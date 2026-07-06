import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { caps } from "@/lib/platformCapabilities";
import { cn } from "@/lib/utils";
import { KEYRING_SERVICE } from "@/modules/ai/config";
import {
  setTtsProvider,
  setSttProvider,
  setWakeWordEnabled,
  setPushToTalkShortcut,
  setOverlayEnabled,
  type TtsProviderId,
  type SttProviderId,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";

const TTS_PROVIDERS: { id: TtsProviderId; label: string; needsKey: boolean }[] =
  [
    { id: "cartesia", label: "Cartesia", needsKey: true },
    ...(caps.nativeTts
      ? [
          {
            id: "avspeech" as TtsProviderId,
            label: "macOS AVSpeech",
            needsKey: false,
          },
        ]
      : []),
  ];

const STT_PROVIDERS: { id: SttProviderId; label: string; needsKey: boolean }[] =
  [
    { id: "whisper", label: "OpenAI Whisper", needsKey: true },
    { id: "deepgram", label: "Deepgram", needsKey: true },
  ];

export function VoiceSettings() {
  const ttsProvider = usePreferencesStore((s) => s.ttsProvider);
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const wakeWordEnabled = usePreferencesStore((s) => s.wakeWordEnabled);
  const pushToTalkShortcut = usePreferencesStore((s) => s.pushToTalkShortcut);
  const overlayEnabled = usePreferencesStore((s) => s.overlayEnabled);
  const [saving, setSaving] = useState<string | null>(null);

  const saveKey = useCallback(async (account: string, value: string) => {
    setSaving(account);
    try {
      if (value.trim()) {
        await invoke("secrets_set", {
          service: KEYRING_SERVICE,
          account,
          password: value.trim(),
        });
      } else {
        await invoke("secrets_delete", { service: KEYRING_SERVICE, account });
      }
    } finally {
      setSaving(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-[12px] font-medium text-foreground">
          Text-to-Speech
        </h3>
        <div className="flex gap-2">
          {TTS_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px]",
                ttsProvider === p.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/40 bg-card/60 text-muted-foreground hover:bg-foreground/[0.04]",
              )}
              onClick={() => void setTtsProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {ttsProvider === "cartesia" && (
          <ApiKeyInput
            label="Cartesia API Key"
            account="cartesia-api-key"
            saving={saving === "cartesia-api-key"}
            onSave={saveKey}
          />
        )}
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-medium text-foreground">
          Speech-to-Text
        </h3>
        <div className="flex gap-2">
          {STT_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px]",
                sttProvider === p.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/40 bg-card/60 text-muted-foreground hover:bg-foreground/[0.04]",
              )}
              onClick={() => void setSttProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {sttProvider === "deepgram" && (
          <ApiKeyInput
            label="Deepgram API Key"
            account="deepgram-api-key"
            saving={saving === "deepgram-api-key"}
            onSave={saveKey}
          />
        )}
      </div>

      {caps.wakeWord && (
        <div>
          <h3 className="mb-2 text-[12px] font-medium text-foreground">
            Wake Word
          </h3>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wakeWordEnabled}
              onChange={(e) => void setWakeWordEnabled(e.target.checked)}
              className="rounded border-border/60"
            />
            <span className="text-[11px] text-muted-foreground">
              Enable wake word detection
            </span>
          </label>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[12px] font-medium text-foreground">
          Push-to-Talk Shortcut
        </h3>
        <input
          type="text"
          value={pushToTalkShortcut}
          onChange={(e) => void setPushToTalkShortcut(e.target.value)}
          className="w-full max-w-48 rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] text-foreground"
        />
      </div>

      {caps.overlay && (
        <div>
          <h3 className="mb-2 text-[12px] font-medium text-foreground">
            Annotation Overlay
          </h3>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={overlayEnabled}
              onChange={(e) => void setOverlayEnabled(e.target.checked)}
              className="rounded border-border/60"
            />
            <span className="text-[11px] text-muted-foreground">
              Enable screen annotation overlay
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

function ApiKeyInput({
  label,
  account,
  saving,
  onSave,
}: {
  label: string;
  account: string;
  saving: boolean;
  onSave: (account: string, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="password"
        placeholder={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground"
      />
      <button
        type="button"
        disabled={saving}
        className="rounded-md border border-border/40 bg-card/60 px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
        onClick={() => void onSave(account, value)}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
