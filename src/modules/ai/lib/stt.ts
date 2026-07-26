import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_NATIVE_SPEECH_PROFILE,
  type NativeSpeechProfile,
} from "../config";
import type { ProviderKeys } from "./keyring";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const STT_TIMEOUT_GROQ_MS = 30_000;
const STT_TIMEOUT_WHISPERCPP_MS = 180_000;
const ERROR_BODY_LIMIT = 500;
const LOCAL_STT_SAMPLE_RATE = 16_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  const detail = (body || res.statusText).trim().slice(0, ERROR_BODY_LIMIT);
  return new Error(`STT request failed (${res.status}): ${detail}`);
}

async function transcribeOpenAI(blob: Blob, apiKey: string): Promise<string> {
  const [{ createOpenAI }, { experimental_transcribe: transcribe }] =
    await Promise.all([import("@ai-sdk/openai"), import("ai")]);
  const openai = createOpenAI({ apiKey });
  const buf = new Uint8Array(await blob.arrayBuffer());
  const { text } = await transcribe({
    model: openai.transcription("whisper-1"),
    audio: buf,
  });
  return text;
}

async function transcribeViaRest(
  baseURL: string,
  blob: Blob,
  apiKey: string | null,
  model: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", blob, "audio.webm");
  form.append("model", model);
  form.append("response_format", "text");

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(
    `${baseURL}/audio/transcriptions`,
    {
      method: "POST",
      headers,
      body: form,
    },
    STT_TIMEOUT_GROQ_MS,
  );
  if (!res.ok) {
    throw await responseError(res);
  }
  return res.text();
}

export function downmixChannels(
  channels: readonly Float32Array[],
): Float32Array {
  if (channels.length === 0) throw new Error("Audio has no channels");
  const length = channels[0].length;
  if (channels.some((channel) => channel.length !== length)) {
    throw new Error("Audio channels have different lengths");
  }
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

export function encodeFloat32Le(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(
    samples.length * Float32Array.BYTES_PER_ELEMENT,
  );
  const view = new DataView(output.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(i * Float32Array.BYTES_PER_ELEMENT, samples[i], true);
  }
  return output;
}

async function decodeMonoAudio(
  blob: Blob,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext({ sampleRate: LOCAL_STT_SAMPLE_RATE });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buf.numberOfChannels }, (_, index) =>
      buf.getChannelData(index),
    );
    return { samples: downmixChannels(channels), sampleRate: buf.sampleRate };
  } finally {
    await ctx.close();
  }
}

async function toWav(blob: Blob): Promise<Blob> {
  const { samples, sampleRate } = await decodeMonoAudio(blob);
  const length = samples.length;
  const dataLen = length * 2;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribeWhisperCpp(
  baseURL: string,
  blob: Blob,
): Promise<string> {
  const wav = await toWav(blob);
  const form = new FormData();
  form.append("file", wav, "audio.wav");
  form.append("response_format", "text");

  const res = await fetchWithTimeout(
    `${baseURL}/inference`,
    {
      method: "POST",
      redirect: "error",
      body: form,
    },
    STT_TIMEOUT_WHISPERCPP_MS,
  );
  if (!res.ok) {
    throw await responseError(res);
  }
  return res.text();
}

export function assertLoopbackUrl(baseURL: string, provider: string): void {
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(`Invalid ${provider} URL: ${baseURL}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${provider} URL must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${provider} URL must not include credentials.`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = host.split(".").map(Number);
  const loopbackIpv4 =
    octets.length === 4 &&
    octets[0] === 127 &&
    octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
    );
  const loopback = host === "localhost" || host === "::1" || loopbackIpv4;
  if (!loopback) {
    throw new Error(
      `${provider} must run on a loopback address to keep transcription local.`,
    );
  }
}

async function transcribeNative(
  profile: NativeSpeechProfile,
  blob: Blob,
): Promise<string> {
  const { samples, sampleRate } = await decodeMonoAudio(blob);
  try {
    return await invoke<string>(
      "stt_native_transcribe",
      encodeFloat32Le(samples),
      {
        headers: {
          "terax-stt-profile": profile,
          "terax-stt-sample-rate": String(sampleRate),
          "terax-stt-language": "auto",
        },
      },
    );
  } catch (error) {
    throw new Error(
      typeof error === "string" ? error : "Native transcription failed",
    );
  }
}

export type SttOptions = {
  groqSttModel?: string;
  whispercppBaseURL?: string;
  nativeSpeechProfile?: NativeSpeechProfile;
};

export async function transcribeAudio(
  blob: Blob,
  provider: import("../config").SttProvider,
  apiKeys: ProviderKeys,
  options: SttOptions = {},
): Promise<string> {
  switch (provider) {
    case "openai": {
      const key = apiKeys.openai;
      if (!key) throw new Error("OpenAI API key is not configured");
      return transcribeOpenAI(blob, key);
    }
    case "groq": {
      const key = apiKeys.groq;
      if (!key) throw new Error("Groq API key is not configured");
      const model = options.groqSttModel || "whisper-large-v3-turbo";
      return transcribeViaRest(GROQ_BASE_URL, blob, key, model);
    }
    case "whispercpp": {
      const baseURL =
        options.whispercppBaseURL?.replace(/\/+$/, "") ||
        "http://127.0.0.1:8080";
      assertLoopbackUrl(baseURL, "Whisper.cpp");
      return transcribeWhisperCpp(baseURL, blob);
    }
    case "native":
      return transcribeNative(
        options.nativeSpeechProfile || DEFAULT_NATIVE_SPEECH_PROFILE,
        blob,
      );
  }
}
