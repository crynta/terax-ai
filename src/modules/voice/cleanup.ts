import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore } from "@/modules/ai/store/chatStore";

const CLEANUP_SYSTEM =
  "You clean up raw speech-to-text transcripts. Fix punctuation, capitalization, and remove speech disfluencies and filler words. Keep the original language, wording, and meaning intact — do not translate, answer, summarize, or add anything. Return ONLY the cleaned transcript text, nothing else.";

export function normalizeTranscript(raw: string): string {
  const text = raw
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function cleanupTranscript(raw: string): Promise<string> {
  const base = normalizeTranscript(raw);
  if (!base) return base;
  const prefs = usePreferencesStore.getState();
  const keys = useChatStore.getState().apiKeys;
  try {
    const [{ generateText }, { buildConfiguredLanguageModel }] =
      await Promise.all([import("ai"), import("@/modules/ai/lib/agent")]);
    const model = await buildConfiguredLanguageModel(prefs.defaultModelId, keys, {
      lmstudioBaseURL: prefs.lmstudioBaseURL,
      lmstudioModelId: prefs.lmstudioModelId,
      mlxBaseURL: prefs.mlxBaseURL,
      mlxModelId: prefs.mlxModelId,
      ollamaBaseURL: prefs.ollamaBaseURL,
      ollamaModelId: prefs.ollamaModelId,
      openaiCompatibleBaseURL: prefs.openaiCompatibleBaseURL,
      openaiCompatibleModelId: prefs.openaiCompatibleModelId,
      openrouterModelId: prefs.openrouterModelId,
      customEndpoints: prefs.customEndpoints,
    });
    const { text } = await generateText({
      model,
      system: CLEANUP_SYSTEM,
      prompt: base,
    });
    return text.trim() || base;
  } catch {
    return base;
  }
}
