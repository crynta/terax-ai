import type {
  WorkflowProviderAdapter,
  WorkflowProviderExecutionContext,
} from "./providerAdapter";
import type {
  WorkflowArtifact,
  WorkflowNode,
  WorkflowPortType,
} from "./schema";

export type OpenAIAudioWorkflowProviderAdapterOptions = {
  getApiKey: () => string | null | undefined;
  fetch?: typeof fetch;
  endpoint?: string;
};

const DEFAULT_OPENAI_AUDIO_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export function createOpenAIAudioWorkflowProviderAdapter(
  options: OpenAIAudioWorkflowProviderAdapterOptions,
): WorkflowProviderAdapter {
  return {
    id: "openai-audio",
    label: "OpenAI Audio",
    priority: 100,
    supports: (node) =>
      node.type === "audioGeneration" && providerConfig(node) === "openai",
    createArtifact: async (context) => {
      const apiKey = options.getApiKey()?.trim();
      if (!apiKey) {
        throw new Error(
          "No API key configured for OpenAI. Open Settings → AI to add one.",
        );
      }

      context.reportProgress({
        message: "Requesting OpenAI audio",
        progress: 0.15,
      });

      const response = await (options.fetch ?? fetch)(
        options.endpoint ?? DEFAULT_OPENAI_AUDIO_ENDPOINT,
        {
          body: JSON.stringify(openAIAudioRequestBody(context)),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: context.signal,
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI audio generation failed (${response.status}): ${await responseErrorMessage(response)}`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new Error("OpenAI audio response did not include audio data");
      }

      context.reportProgress({
        message: "OpenAI audio received",
        progress: 0.9,
      });

      return audioArtifactFromResponse(context, response, bytes);
    },
  };
}

function openAIAudioRequestBody(
  context: WorkflowProviderExecutionContext,
): Record<string, number | string> {
  const body: Record<string, number | string> = {
    input: promptForAudioGeneration(context),
    model: stringConfig(context.node.config.model, "gpt-4o-mini-tts"),
    voice: stringConfig(context.node.config.voice, "alloy"),
  };

  const responseFormat = responseFormatConfig(context.node);
  if (responseFormat) body.response_format = responseFormat;
  const speed = optionalNumberConfig(context.node.config.speed);
  if (speed !== null) body.speed = speed;

  return body;
}

function audioArtifactFromResponse(
  context: WorkflowProviderExecutionContext,
  response: Response,
  bytes: Uint8Array,
): WorkflowArtifact {
  const model = stringConfig(context.node.config.model, "gpt-4o-mini-tts");
  const voice = stringConfig(context.node.config.voice, "alloy");
  const responseFormat = responseFormatConfig(context.node);
  const mediaType =
    mediaTypeFromResponse(response) ?? mediaTypeForAudioFormat(responseFormat);

  return {
    id: context.artifactId,
    nodeId: context.node.id,
    portId: context.outputPortId,
    type: audioOutputType(context.outputType),
    label: context.node.title,
    preview: `data:${mediaType};base64,${base64FromBytes(bytes)}`,
    value: {
      adapterId: "openai-audio",
      model,
      provider: "openai",
      responseFormat,
      source: "binary",
      voice,
    },
  };
}

function promptForAudioGeneration(
  context: WorkflowProviderExecutionContext,
): string {
  const promptArtifact = context.inputArtifacts.find(
    (artifact) => artifact.type === "text",
  );
  const prompt =
    stringFromUnknown(promptArtifact?.value) ?? promptArtifact?.preview;
  const configuredPrompt = stringFromUnknown(context.node.config.prompt);
  const resolved = prompt ?? configuredPrompt;
  if (!resolved?.trim()) {
    throw new Error("OpenAI audio generation requires a text prompt");
  }
  return resolved.trim();
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return response.statusText || "Request failed";

  try {
    const json = JSON.parse(text) as { error?: { message?: unknown } };
    const message = json.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    return text.trim();
  }

  return text.trim();
}

function providerConfig(node: WorkflowNode): string {
  return stringConfig(node.config.provider, "").toLowerCase();
}

function audioOutputType(outputType: WorkflowPortType): WorkflowPortType {
  return outputType === "audio" ? outputType : "audio";
}

function responseFormatConfig(node: WorkflowNode): string {
  return (
    optionalStringConfig(node.config.responseFormat) ??
    optionalStringConfig(node.config.response_format) ??
    "mp3"
  );
}

function mediaTypeFromResponse(response: Response): string | null {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType || null;
}

function mediaTypeForAudioFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === "wav") return "audio/wav";
  if (normalized === "ogg") return "audio/ogg";
  if (normalized === "opus") return "audio/ogg";
  if (normalized === "aac") return "audio/aac";
  if (normalized === "flac") return "audio/flac";
  if (normalized === "m4a" || normalized === "mp4") return "audio/mp4";
  return "audio/mpeg";
}

function optionalStringConfig(value: unknown): string | null {
  const resolved = stringFromUnknown(value);
  return resolved && resolved.length > 0 ? resolved : null;
}

function optionalNumberConfig(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringConfig(value: unknown, fallback: string): string {
  return optionalStringConfig(value) ?? fallback;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function base64FromBytes(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[chunk & 63] : "=";
  }
  return output;
}
