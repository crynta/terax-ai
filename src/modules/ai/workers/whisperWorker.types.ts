export type WhisperWorkerIn =
  | { kind: "load"; model: string }
  | { kind: "transcribe"; pcm: Float32Array; language?: string }
  | { kind: "unload" };

export type WhisperWorkerOut =
  | { kind: "progress"; file: string; loaded: number; total: number }
  | { kind: "ready"; model: string; backend: "gpu" | "cpu" }
  | { kind: "result"; text: string }
  | { kind: "error"; message: string };
