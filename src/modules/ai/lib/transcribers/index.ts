import { createLocalTranscriber, type LocalTranscriber } from "./local";
import { createOpenAITranscriber } from "./openai";

export type TranscriberState =
  | { kind: "idle" }
  | { kind: "loading"; file?: string; loaded: number; total: number }
  | { kind: "loaded"; backend: "gpu" | "cpu" }
  | { kind: "error"; message: string };

export interface Transcriber {
  /** Whether the user can press the mic button right now. */
  ready(): boolean;
  /** Optional explanation when ready() is false. */
  unavailableReason(): string | null;
  /** Begin pre-loading any expensive setup (model download/warmup). No-op for OpenAI. */
  preload(): void;
  /** Run transcription. May await preload internally. */
  transcribe(blob: Blob): Promise<string>;
  /** Subscribe to state changes. */
  subscribe(listener: (state: TranscriberState) => void): () => void;
  getState(): TranscriberState;
  /** Free any owned resources (worker, etc.). */
  unload(): void;
  /** True for the local provider — used by UI to gate "Unload" affordance. */
  readonly isLocal: boolean;
}

export type TranscriberSelection =
  | { kind: "openai"; apiKey: string | null }
  | { kind: "local"; model: string; language: string };

export function createTranscriber(sel: TranscriberSelection): Transcriber {
  if (sel.kind === "openai") {
    return createOpenAITranscriber({ apiKey: sel.apiKey });
  }
  return createLocalTranscriber({ model: sel.model, language: sel.language });
}

export type { LocalTranscriber };
