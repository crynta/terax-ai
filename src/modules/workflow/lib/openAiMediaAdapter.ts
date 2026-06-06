import type {
  WorkflowProviderAdapter,
  WorkflowProviderExecutionContext,
} from "./providerAdapter";
import type {
  WorkflowArtifact,
  WorkflowNode,
  WorkflowPortType,
} from "./schema";

export type OpenAIImageWorkflowProviderAdapterOptions = {
  getApiKey: () => string | null | undefined;
  fetch?: typeof fetch;
  endpoint?: string;
};

type OpenAIImageResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    url?: string;
  }>;
  output_format?: string;
};

const DEFAULT_OPENAI_IMAGE_ENDPOINT =
  "https://api.openai.com/v1/images/generations";

export function createOpenAIImageWorkflowProviderAdapter(
  options: OpenAIImageWorkflowProviderAdapterOptions,
): WorkflowProviderAdapter {
  return {
    id: "openai-image",
    label: "OpenAI Images",
    priority: 100,
    supports: (node) =>
      node.type === "imageGeneration" && providerConfig(node) === "openai",
    createArtifact: async (context) => {
      const apiKey = options.getApiKey()?.trim();
      if (!apiKey) {
        throw new Error(
          "No API key configured for OpenAI. Open Settings → AI to add one.",
        );
      }

      context.reportProgress({
        message: "Requesting OpenAI image",
        progress: 0.15,
      });

      const response = await (options.fetch ?? fetch)(
        options.endpoint ?? DEFAULT_OPENAI_IMAGE_ENDPOINT,
        {
          body: JSON.stringify(openAIImageRequestBody(context)),
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
          `OpenAI image generation failed (${response.status}): ${await responseErrorMessage(response)}`,
        );
      }

      const payload = (await response.json()) as OpenAIImageResponse;
      const image = payload.data?.[0];
      if (!image?.b64_json && !image?.url) {
        throw new Error("OpenAI image response did not include an image");
      }

      context.reportProgress({
        message: "OpenAI image received",
        progress: 0.9,
      });

      return imageArtifactFromResponse(context, payload, image);
    },
  };
}

function openAIImageRequestBody(
  context: WorkflowProviderExecutionContext,
): Record<string, string> {
  const body: Record<string, string> = {
    model: stringConfig(context.node.config.model, "gpt-image-2"),
    prompt: promptForImageGeneration(context),
  };

  const size = optionalStringConfig(context.node.config.size);
  if (size) body.size = size;
  const quality = optionalStringConfig(context.node.config.quality);
  if (quality) body.quality = quality;
  const background = optionalStringConfig(context.node.config.background);
  if (background) body.background = background;
  const outputFormat = optionalStringConfig(context.node.config.outputFormat);
  if (outputFormat) body.output_format = outputFormat;

  return body;
}

function imageArtifactFromResponse(
  context: WorkflowProviderExecutionContext,
  payload: OpenAIImageResponse,
  image: NonNullable<OpenAIImageResponse["data"]>[number],
): WorkflowArtifact {
  const model = stringConfig(context.node.config.model, "gpt-image-2");
  const outputFormat =
    payload.output_format || outputFormatConfig(context.node);
  const mediaType = mediaTypeForImageFormat(outputFormat);
  const preview = image.b64_json
    ? `data:${mediaType};base64,${image.b64_json}`
    : (image.url ?? "");

  return {
    id: context.artifactId,
    nodeId: context.node.id,
    portId: context.outputPortId,
    type: imageOutputType(context.outputType),
    label: context.node.title,
    preview,
    value: {
      adapterId: "openai-image",
      model,
      provider: "openai",
      ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {}),
      ...(outputFormat ? { outputFormat } : {}),
      source: image.b64_json ? "b64_json" : "url",
    },
  };
}

function promptForImageGeneration(
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
    throw new Error("OpenAI image generation requires a text prompt");
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
    // Fall through to the plain-text response body.
  }

  return text.trim();
}

function providerConfig(node: WorkflowNode): string {
  return stringConfig(node.config.provider, "").toLowerCase();
}

function imageOutputType(outputType: WorkflowPortType): WorkflowPortType {
  return outputType === "image" ? outputType : "image";
}

function outputFormatConfig(node: WorkflowNode): string {
  return optionalStringConfig(node.config.outputFormat) ?? "png";
}

function mediaTypeForImageFormat(format: string): string {
  const normalized = format.toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  return "image/png";
}

function optionalStringConfig(value: unknown): string | null {
  const resolved = stringFromUnknown(value);
  return resolved && resolved.length > 0 ? resolved : null;
}

function stringConfig(value: unknown, fallback: string): string {
  return optionalStringConfig(value) ?? fallback;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}
