import type { ProviderKeys } from "./keyring";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

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
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseURL}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `STT request failed (${res.status}): ${body || res.statusText}`,
    );
  }
  return res.text();
}

async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = buf.length;
    const sampleRate = buf.sampleRate;
    const channel = buf.getChannelData(0);
    const dataLen = length * 2;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);

    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
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
      const s = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    ctx.close();
  }
}

async function transcribeWhisperCpp(
  baseURL: string,
  blob: Blob,
): Promise<string> {
  const wav = await toWav(blob);
  const form = new FormData();
  form.append("file", wav, "audio.wav");
  form.append("response_format", "text");

  const res = await fetch(`${baseURL}/inference`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `STT request failed (${res.status}): ${body || res.statusText}`,
    );
  }
  return res.text();
}

export type SttOptions = {
  groqSttModel?: string;
  whispercppBaseURL?: string;
  whispercppModel?: string;
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
      const baseURL = options.whispercppBaseURL?.replace(/\/+$/, "") || "http://127.0.0.1:8080";
      return transcribeWhisperCpp(baseURL, blob);
    }
  }
}
