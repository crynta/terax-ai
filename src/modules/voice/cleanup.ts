import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore } from "@/modules/ai/store/chatStore";

const CLEANUP_SYSTEM =
  "You clean up raw speech-to-text transcripts. Fix punctuation, capitalization, and remove speech disfluencies and filler words. Keep the original language, wording, and meaning intact — do not translate, answer, summarize, or add anything. Return ONLY the cleaned transcript text, nothing else.";

export const CLEANUP_MIN_RETENTION = 0.6;
export const CLEANUP_MAX_CHARS = 4000;
export const CLEANUP_OUTPUT_TOKEN_CAP = 4096;

export function normalizeTranscript(raw: string): string {
  const text = raw
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function shouldSkipCleanup(
  text: string,
  maxChars: number = CLEANUP_MAX_CHARS,
): boolean {
  return text.length > maxChars;
}

export function cleanupOutputTokens(
  text: string,
  cap: number = CLEANUP_OUTPUT_TOKEN_CAP,
): number {
  return Math.min(cap, Math.ceil(text.length / 3) + 256);
}

export function keepsFullTranscript(
  original: string,
  cleaned: string,
  minRetention: number = CLEANUP_MIN_RETENTION,
): boolean {
  const kept = cleaned.trim();
  if (!kept) return false;
  const source = original.trim();
  if (!source) return false;
  return kept.length >= Math.floor(source.length * minRetention);
}

type Prefs = ReturnType<typeof usePreferencesStore.getState>;
type Keys = ReturnType<typeof useChatStore.getState>["apiKeys"];

async function buildCleanupModel(prefs: Prefs, keys: Keys) {
  const { buildConfiguredLanguageModel } = await import(
    "@/modules/ai/lib/agent"
  );
  const options = {
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
  };
  const preferred = prefs.voiceCleanupModelId.trim();
  if (preferred && preferred !== prefs.defaultModelId) {
    try {
      return await buildConfiguredLanguageModel(preferred, keys, options);
    } catch {
      return buildConfiguredLanguageModel(prefs.defaultModelId, keys, options);
    }
  }
  return buildConfiguredLanguageModel(prefs.defaultModelId, keys, options);
}

export async function cleanupTranscript(raw: string): Promise<string> {
  const base = normalizeTranscript(raw);
  if (!base || shouldSkipCleanup(base)) return base;
  const prefs = usePreferencesStore.getState();
  const keys = useChatStore.getState().apiKeys;
  try {
    const [{ generateText }, model] = await Promise.all([
      import("ai"),
      buildCleanupModel(prefs, keys),
    ]);
    const { text } = await generateText({
      model,
      system: CLEANUP_SYSTEM,
      prompt: base,
      maxOutputTokens: cleanupOutputTokens(base),
    });
    const cleaned = text.trim();
    return keepsFullTranscript(base, cleaned) ? cleaned : base;
  } catch {
    return base;
  }
}
