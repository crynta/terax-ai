import { blobToMonoPcm16k } from "../audio";
import type { Transcriber, TranscriberState } from "./index";
import type { WhisperWorkerIn, WhisperWorkerOut } from "../../workers/whisperWorker.types";

export interface LocalTranscriber extends Transcriber {
  /** Force-reload the worker (used after model change). */
  reload(): void;
}

export function createLocalTranscriber(opts: {
  model: string;
  language: string;
}): LocalTranscriber {
  const listeners = new Set<(s: TranscriberState) => void>();
  let state: TranscriberState = { kind: "idle" };
  let worker: Worker | null = null;
  let readyResolve: (() => void) | null = null;
  let readyPromise: Promise<void> | null = null;
  let pendingTranscribe:
    | { resolve: (text: string) => void; reject: (e: Error) => void }
    | null = null;

  function setState(next: TranscriberState) {
    state = next;
    for (const l of listeners) l(state);
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(
      new URL("../../workers/whisperWorker.ts", import.meta.url),
      { type: "module" },
    );
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    worker.onmessage = (ev: MessageEvent<WhisperWorkerOut>) => {
      const m = ev.data;
      if (m.kind === "progress") {
        setState({
          kind: "loading",
          file: m.file,
          loaded: m.loaded,
          total: m.total,
        });
        return;
      }
      if (m.kind === "ready") {
        setState({ kind: "loaded", backend: m.backend });
        readyResolve?.();
        return;
      }
      if (m.kind === "result") {
        if (state.kind !== "loaded") {
          // Worker shouldn't have sent result without ready, but stay defensive
          setState({ kind: "loaded", backend: "cpu" });
        }
        const p = pendingTranscribe;
        pendingTranscribe = null;
        p?.resolve(m.text);
        return;
      }
      if (m.kind === "error") {
        setState({ kind: "error", message: m.message });
        const p = pendingTranscribe;
        pendingTranscribe = null;
        p?.reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      setState({ kind: "error", message: String(e.message ?? e) });
      const p = pendingTranscribe;
      pendingTranscribe = null;
      p?.reject(new Error(e.message || "worker error"));
    };

    const msg: WhisperWorkerIn = { kind: "load", model: opts.model };
    worker.postMessage(msg);
    setState({ kind: "loading", loaded: 0, total: 0 });
  }

  return {
    isLocal: true,
    ready: () => true,
    unavailableReason: () => null,
    preload: () => ensureWorker(),
    async transcribe(blob) {
      ensureWorker();
      await readyPromise;
      const pcm = await blobToMonoPcm16k(blob);
      if (pcm.length < 16_000 * 0.2) {
        return "";
      }
      return new Promise<string>((resolve, reject) => {
        pendingTranscribe = { resolve, reject };
        const msg: WhisperWorkerIn = {
          kind: "transcribe",
          pcm,
          language: opts.language,
        };
        worker!.postMessage(msg, [pcm.buffer as ArrayBuffer]);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    unload: () => {
      const p = pendingTranscribe;
      pendingTranscribe = null;
      p?.reject(new Error("transcriber unloaded"));
      worker?.terminate();
      worker = null;
      readyResolve = null;
      readyPromise = null;
      setState({ kind: "idle" });
    },
    reload: () => {
      const p = pendingTranscribe;
      pendingTranscribe = null;
      p?.reject(new Error("transcriber unloaded"));
      worker?.terminate();
      worker = null;
      readyResolve = null;
      readyPromise = null;
      setState({ kind: "idle" });
      ensureWorker();
    },
  };
}
