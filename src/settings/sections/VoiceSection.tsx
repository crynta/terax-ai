import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  WHISPER_MODELS,
  setVoiceProvider,
  setLocalWhisperModel,
  setLocalWhisperLanguage,
  type WhisperModelId,
} from "@/modules/settings/store";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function VoiceSection() {
  const voiceProvider = usePreferencesStore((s) => s.voiceProvider);
  const localModel = usePreferencesStore((s) => s.localWhisperModel);
  const localLanguage = usePreferencesStore((s) => s.localWhisperLanguage);
  const openaiKey = useChatStore((s) => s.apiKeys.openai);

  const isLocal = voiceProvider === "local";
  const activeModel = WHISPER_MODELS.find((m) => m.id === localModel);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Voice input"
        description="Transcribe speech to text in the composer. Choose a local model for offline use, or OpenAI's hosted Whisper for the lowest setup cost."
      />

      <div className="flex flex-col gap-2">
        <SettingRow
          title="Provider"
          description={
            voiceProvider === "openai" && !openaiKey
              ? "OpenAI cloud needs an API key (configure in Models)."
              : isLocal
                ? "Local runs the model in-app — no internet, no API key."
                : "OpenAI cloud — uses your OpenAI API key for transcription."
          }
        >
          <Select
            value={voiceProvider}
            onValueChange={(v) => void setVoiceProvider(v as "openai" | "local")}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local (in-app)</SelectItem>
              <SelectItem value="openai">OpenAI cloud</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {isLocal && (
          <>
            <SettingRow
              title="Model"
              description={
                activeModel
                  ? `${activeModel.sizeMB} MB · ${activeModel.multilingual ? "multilingual" : "English only"} · downloads on first use`
                  : undefined
              }
            >
              <Select
                value={localModel}
                onValueChange={(v) => void setLocalWhisperModel(v as WhisperModelId)}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHISPER_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label} · {m.sizeMB} MB
                      {m.multilingual ? "" : " · EN"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow
              title="Language"
              description='ISO 639-1 code (e.g. "en", "de"). Use "auto" to let the model detect. Ignored by ".en" models.'
            >
              <Input
                value={localLanguage}
                onChange={(e) => void setLocalWhisperLanguage(e.target.value)}
                placeholder="auto"
                className="h-8 w-24 text-xs"
              />
            </SettingRow>
          </>
        )}
      </div>
    </div>
  );
}
