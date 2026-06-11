import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { splitSentences } from "@/modules/ai/lib/sentenceSplit";

export type TtsStatus = {
  speaking: boolean;
  provider: string;
  queued: number;
};

export type UseTtsResult = {
  speaking: boolean;
  loading: boolean;
  error: string | null;
  activeMessageId: string | null;
  speak: (text: string, messageId: string) => void;
  stop: () => void;
};

const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function useTts(): UseTtsResult {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current = true;
    };
  }, []);

  const pollStatus = useCallback(async () => {
    const start = Date.now();
    try {
      while (!abortRef.current && mountedRef.current) {
        const status = await invoke<TtsStatus>("tts_status");
        if (!mountedRef.current) return;
        if (!status.speaking) {
          setSpeaking(false);
          setLoading(false);
          setActiveMessageId(null);
          activeRef.current = false;
          return;
        }
        if (Date.now() - start > POLL_TIMEOUT_MS) {
          invoke("tts_stop").catch(() => {});
          setSpeaking(false);
          setLoading(false);
          setActiveMessageId(null);
          activeRef.current = false;
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch {
      if (mountedRef.current) {
        setSpeaking(false);
        setLoading(false);
        setActiveMessageId(null);
        activeRef.current = false;
      }
    }
  }, []);

  const speak = useCallback(
    (text: string, messageId: string) => {
      if (activeRef.current) return;
      activeRef.current = true;
      setError(null);
      setLoading(true);
      setSpeaking(true);
      setActiveMessageId(messageId);
      abortRef.current = false;

      const sentences = splitSentences(text);
      const speakAll = async () => {
        for (const sentence of sentences) {
          if (abortRef.current || !mountedRef.current) break;
          try {
            await invoke("tts_speak", { text: sentence, provider: "cartesia" });
          } catch (e: unknown) {
            if (mountedRef.current) {
              const msg = e instanceof Error ? e.message : String(e);
              setError(msg);
            }
            break;
          }
        }
        if (mountedRef.current) {
          setLoading(false);
          void pollStatus();
        }
      };
      void speakAll();
    },
    [pollStatus],
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    activeRef.current = false;
    invoke("tts_stop").catch(() => {});
    setSpeaking(false);
    setLoading(false);
    setActiveMessageId(null);
  }, []);

  return { speaking, loading, error, activeMessageId, speak, stop };
}
