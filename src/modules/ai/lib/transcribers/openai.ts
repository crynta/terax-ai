import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import type { Transcriber, TranscriberState } from "./index";

export function createOpenAITranscriber(opts: { apiKey: string | null }): Transcriber {
  const listeners = new Set<(s: TranscriberState) => void>();
  let state: TranscriberState = opts.apiKey
    ? { kind: "loaded", backend: "cpu" }
    : { kind: "error", message: "OpenAI API key not configured" };

  function setState(next: TranscriberState) {
    state = next;
    for (const l of listeners) l(state);
  }

  return {
    isLocal: false,
    ready: () => state.kind === "loaded",
    unavailableReason: () => (state.kind === "error" ? state.message : null),
    preload: () => {},
    async transcribe(blob) {
      if (!opts.apiKey) throw new Error("OpenAI API key not configured");
      setState({ kind: "loading", loaded: 0, total: 0 });
      try {
        const openai = createOpenAI({ apiKey: opts.apiKey });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const { text } = await transcribe({
          model: openai.transcription("whisper-1"),
          audio: buf,
        });
        setState({ kind: "loaded", backend: "cpu" });
        return text;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message });
        throw e;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    unload: () => {},
  };
}
