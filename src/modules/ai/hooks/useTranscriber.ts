import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { caps } from "@/lib/platformCapabilities";

export type TranscriberProvider = "whisper" | "deepgram";
export type AllTranscriberProvider = TranscriberProvider | "local";

export type TranscriptionResult = {
  text: string;
  provider: string;
  confidence: number | null;
};

export function useTranscriber() {
  const [provider, setProvider] = useState<TranscriberProvider>("deepgram");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableProviders: AllTranscriberProvider[] = [
    "whisper",
    "deepgram",
    ...(caps.localStt ? ["local" as AllTranscriberProvider] : []),
  ];

  const transcribe = useCallback(
    async (blob: Blob): Promise<string | null> => {
      if (provider === "whisper") return null;
      setLoading(true);
      setError(null);
      try {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const result = await invoke<TranscriptionResult>("transcribe_audio", {
          audioData: Array.from(buf),
          mimeType: blob.type || "audio/webm",
          provider,
        });
        return result.text?.trim() || null;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [provider],
  );

  return {
    provider,
    setProvider,
    transcribe,
    loading,
    error,
    availableProviders,
  };
}
