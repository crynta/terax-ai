import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROVIDER_KEYS, type ProviderKeys } from "./keyring";

const openaiSdk = vi.hoisted(() => {
  const transcription = vi.fn();
  const createOpenAI = vi.fn(() => ({ transcription }));
  return { createOpenAI, transcription };
});

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: openaiSdk.createOpenAI }));

const aiSdk = vi.hoisted(() => ({
  experimental_transcribe: vi.fn(async () => ({ text: "hello world" })),
}));

vi.mock("ai", () => ({ experimental_transcribe: aiSdk.experimental_transcribe }));

import { transcribeAudio } from "./stt";

const fetchMock = vi.fn();
const blob = new Blob(["audio-bytes"], { type: "audio/webm" });
const keys = (partial: Partial<ProviderKeys>): ProviderKeys => ({
  ...EMPTY_PROVIDER_KEYS,
  ...partial,
});

class FakeAudioContext {
  decodeAudioData() {
    return Promise.resolve({
      length: 2,
      sampleRate: 44100,
      getChannelData: () => Float32Array.from([0.5, -0.5]),
    });
  }
  close() {}
}

function stubWhisperHappyPath(response = "transcript") {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  fetchMock.mockImplementation(() => new Response(response, { status: 200 }));
}

describe("speech-to-text providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    openaiSdk.createOpenAI.mockClear();
    openaiSdk.transcription.mockClear();
    aiSdk.experimental_transcribe.mockClear();
  });

  it("refuses a non-loopback whisper.cpp URL before any request", async () => {
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudio(blob, "whispercpp", EMPTY_PROVIDER_KEYS, { whispercppBaseURL: "http://192.168.1.10:8080" }),
    ).rejects.toThrow(/loopback/);
    await expect(
      transcribeAudio(blob, "whispercpp", EMPTY_PROVIDER_KEYS, { whispercppBaseURL: "http://example.com" }),
    ).rejects.toThrow(/loopback/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unparseable whisper.cpp URL", async () => {
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudio(blob, "whispercpp", EMPTY_PROVIDER_KEYS, { whispercppBaseURL: "not-a-url" }),
    ).rejects.toThrow(/Invalid Whisper.cpp URL/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts loopback forms and strips the trailing slash from the base URL", async () => {
    stubWhisperHappyPath();

    const bases = [
      "http://localhost:8080/",
      "http://127.0.0.1:8080///",
      "http://[::1]:8080/",
    ];
    for (const baseURL of bases) {
      await expect(
        transcribeAudio(blob, "whispercpp", EMPTY_PROVIDER_KEYS, { whispercppBaseURL: baseURL }),
      ).resolves.toBe("transcript");
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringMatching(/^http:\/\/(localhost|\[::1\]|127\.0\.0\.1):8080\/inference$/),
        expect.objectContaining({ method: "POST" }),
      );
    }
  });

  it("defaults the whisper.cpp endpoint to local port 8080", async () => {
    stubWhisperHappyPath("ok");

    await expect(transcribeAudio(blob, "whispercpp", EMPTY_PROVIDER_KEYS)).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/inference",
      expect.anything(),
    );
  });

  it("requires an OpenAI key before touching the network", async () => {
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio(blob, "openai", EMPTY_PROVIDER_KEYS)).rejects.toThrow(
      /OpenAI API key is not configured/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes OpenAI dictation through the AI SDK transcription path", async () => {
    const transcriptionModel = { modelId: "whisper-1" };
    openaiSdk.transcription.mockReturnValue(transcriptionModel);

    await expect(
      transcribeAudio(blob, "openai", keys({ openai: "sk-openai" })),
    ).resolves.toBe("hello world");

    expect(openaiSdk.createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai" });
    expect(aiSdk.experimental_transcribe).toHaveBeenCalledWith({
      model: transcriptionModel,
      audio: expect.any(Uint8Array),
    });
  });

  it("requires a Groq key before touching the network", async () => {
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio(blob, "groq", EMPTY_PROVIDER_KEYS)).rejects.toThrow(
      /Groq API key is not configured/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts Groq dictation with the bearer key and selected model", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("groq transcript", { status: 200 }));

    await expect(
      transcribeAudio(
        blob,
        "groq",
        keys({ groq: "gsk-groq" }),
        { groqSttModel: "whisper-small" },
      ),
    ).resolves.toBe("groq transcript");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.headers["Authorization"]).toBe("Bearer gsk-groq");
    expect((init.body as FormData).get("model")).toBe("whisper-small");
  });

  it("defaults the Groq model when none is configured", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await transcribeAudio(blob, "groq", keys({ groq: "gsk-groq" }));

    const [, init] = fetchMock.mock.calls[0];
    expect((init.body as FormData).get("model")).toBe("whisper-large-v3-turbo");
  });

  it("surfaces the upstream status and body on Groq failures", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("quota exceeded", { status: 429 }));

    await expect(transcribeAudio(blob, "groq", keys({ groq: "gsk-groq" }))).rejects.toThrow(
      /STT request failed \(429\): quota exceeded/,
    );
  });
});
