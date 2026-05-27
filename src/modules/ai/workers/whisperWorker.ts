/* eslint-disable @typescript-eslint/no-explicit-any */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WhisperWorkerIn, WhisperWorkerOut } from "./whisperWorker.types";

// Allow the library to fetch ONNX builds from the HF Hub.
env.allowRemoteModels = true;
env.allowLocalModels = false;

let currentModel: string | null = null;
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadingPromise: Promise<void> | null = null;
let loadedBackend: "gpu" | "cpu" = "cpu";
let generation = 0; // bumped on every load/unload to cancel stale in-flight loads

function post(msg: WhisperWorkerOut, transfer?: Transferable[]) {
  if (transfer) (self as any).postMessage(msg, transfer);
  else (self as any).postMessage(msg);
}

async function ensureLoaded(model: string): Promise<void> {
  if (asr && currentModel === model) return;
  if (loadingPromise && currentModel === model) return loadingPromise;

  const myGen = ++generation;
  asr = null;
  currentModel = model;

  const progressCallback = (p: any) => {
    if (p?.status === "progress") {
      post({
        kind: "progress",
        file: p.file ?? "",
        loaded: p.loaded ?? 0,
        total: p.total ?? 0,
      });
    }
  };

  loadingPromise = (async () => {
    let pipe: AutomaticSpeechRecognitionPipeline;
    try {
      pipe = (await pipeline("automatic-speech-recognition", model, {
        device: "webgpu",
        progress_callback: progressCallback,
      })) as AutomaticSpeechRecognitionPipeline;
      if (myGen !== generation) return; // superseded — discard
      asr = pipe;
      loadedBackend = "gpu";
    } catch (e) {
      console.warn("[whisper] WebGPU init failed, falling back to WASM:", e);
      pipe = (await pipeline("automatic-speech-recognition", model, {
        progress_callback: progressCallback,
      })) as AutomaticSpeechRecognitionPipeline;
      if (myGen !== generation) return; // superseded — discard
      asr = pipe;
      loadedBackend = "cpu";
    }
    post({ kind: "ready", model, backend: loadedBackend });
  })();

  try {
    await loadingPromise;
  } finally {
    if (myGen === generation) loadingPromise = null;
  }
}

self.onmessage = async (ev: MessageEvent<WhisperWorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.kind === "load") {
      await ensureLoaded(msg.model);
      return;
    }
    if (msg.kind === "unload") {
      generation++;
      asr = null;
      currentModel = null;
      loadingPromise = null;
      return;
    }
    if (msg.kind === "transcribe") {
      if (!asr) {
        post({ kind: "error", message: "Model not loaded" });
        return;
      }
      const result: any = await asr(msg.pcm, {
        language: msg.language && msg.language !== "auto" ? msg.language : undefined,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = typeof result?.text === "string" ? result.text : "";
      post({ kind: "result", text });
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ kind: "error", message });
  }
};
