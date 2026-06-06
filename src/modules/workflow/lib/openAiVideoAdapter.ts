import type {
  WorkflowProviderAdapter,
  WorkflowProviderExecutionContext,
} from "./providerAdapter";
import type {
  WorkflowArtifact,
  WorkflowNode,
  WorkflowPortType,
} from "./schema";

export type OpenAIVideoWorkflowProviderAdapterOptions = {
  getApiKey: () => string | null | undefined;
  fetch?: typeof fetch;
  endpoint?: string;
  maxPolls?: number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

type OpenAIVideoJob = {
  id?: string;
  error?: { code?: string; message?: string } | null;
  model?: string;
  progress?: number | null;
  seconds?: string | number | null;
  size?: string | null;
  status?: "queued" | "in_progress" | "completed" | "failed" | string;
};

const DEFAULT_OPENAI_VIDEO_ENDPOINT = "https://api.openai.com/v1/videos";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLLS = 60;

export function createOpenAIVideoWorkflowProviderAdapter(
  options: OpenAIVideoWorkflowProviderAdapterOptions,
): WorkflowProviderAdapter {
  return {
    id: "openai-video",
    label: "OpenAI Video",
    priority: 100,
    supports: (node) =>
      node.type === "videoGeneration" && providerConfig(node) === "openai",
    createArtifact: async (context) => {
      const apiKey = options.getApiKey()?.trim();
      if (!apiKey) {
        throw new Error(
          "No API key configured for OpenAI. Open Settings → AI to add one.",
        );
      }

      const endpoint = options.endpoint ?? DEFAULT_OPENAI_VIDEO_ENDPOINT;
      context.reportProgress({
        message: "Creating OpenAI video",
        progress: 0.1,
      });

      let job = await createVideoJob(context, endpoint, apiKey, options);
      reportVideoJobProgress(context, job);
      job = await pollVideoJob(context, job, endpoint, apiKey, options);

      context.reportProgress({
        message: "Downloading OpenAI video",
        progress: 0.95,
      });
      const content = await downloadVideoContent(
        job,
        endpoint,
        apiKey,
        options,
      );
      context.reportProgress({
        message: "OpenAI video received",
        progress: 1,
      });

      return videoArtifactFromResponse(context, job, content);
    },
  };
}

async function createVideoJob(
  context: WorkflowProviderExecutionContext,
  endpoint: string,
  apiKey: string,
  options: OpenAIVideoWorkflowProviderAdapterOptions,
): Promise<OpenAIVideoJob> {
  const response = await (options.fetch ?? fetch)(endpoint, {
    body: JSON.stringify(openAIVideoRequestBody(context)),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: context.signal,
  });
  if (!response.ok) {
    throw new Error(
      `OpenAI video generation failed (${response.status}): ${await responseErrorMessage(response)}`,
    );
  }
  return requireVideoJob(await response.json());
}

async function pollVideoJob(
  context: WorkflowProviderExecutionContext,
  initialJob: OpenAIVideoJob,
  endpoint: string,
  apiKey: string,
  options: OpenAIVideoWorkflowProviderAdapterOptions,
): Promise<OpenAIVideoJob> {
  let job = initialJob;
  let polls = 0;
  while (job.status === "queued" || job.status === "in_progress") {
    if (polls >= (options.maxPolls ?? DEFAULT_MAX_POLLS)) {
      throw new Error("OpenAI video generation timed out");
    }
    polls += 1;
    await (options.sleep ?? sleep)(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      context.signal,
    );
    const response = await (options.fetch ?? fetch)(
      `${trimTrailingSlash(endpoint)}/${encodeURIComponent(job.id ?? "")}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        method: "GET",
        signal: context.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `OpenAI video status failed (${response.status}): ${await responseErrorMessage(response)}`,
      );
    }
    job = requireVideoJob(await response.json());
    reportVideoJobProgress(context, job);
  }

  if (job.status === "failed") {
    throw new Error(job.error?.message || "OpenAI video generation failed");
  }
  if (job.status !== "completed") {
    throw new Error(`OpenAI video generation ended with status ${job.status}`);
  }
  return job;
}

async function downloadVideoContent(
  job: OpenAIVideoJob,
  endpoint: string,
  apiKey: string,
  options: OpenAIVideoWorkflowProviderAdapterOptions,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response = await (options.fetch ?? fetch)(
    `${trimTrailingSlash(endpoint)}/${encodeURIComponent(job.id ?? "")}/content`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "GET",
      signal: optionsSignal(options),
    },
  );
  if (!response.ok) {
    throw new Error(
      `OpenAI video download failed (${response.status}): ${await responseErrorMessage(response)}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("OpenAI video response did not include video data");
  }
  return {
    bytes,
    mediaType: mediaTypeFromResponse(response) ?? "video/mp4",
  };
}

function openAIVideoRequestBody(
  context: WorkflowProviderExecutionContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: stringConfig(context.node.config.model, "sora-2"),
    prompt: promptForVideoGeneration(context),
  };

  const size = optionalStringConfig(context.node.config.size);
  if (size) body.size = size;
  const seconds = optionalSecondsConfig(context.node.config.seconds);
  if (seconds) body.seconds = seconds;
  const quality = optionalStringConfig(context.node.config.quality);
  if (quality) body.quality = quality;

  const imageReference = imageReferenceForVideoGeneration(context);
  if (imageReference) body.input_reference = { image_url: imageReference };

  return body;
}

function videoArtifactFromResponse(
  context: WorkflowProviderExecutionContext,
  job: OpenAIVideoJob,
  content: { bytes: Uint8Array; mediaType: string },
): WorkflowArtifact {
  const model = stringConfig(context.node.config.model, "sora-2");
  const size =
    stringFromUnknown(job.size) ??
    optionalStringConfig(context.node.config.size);
  const seconds =
    stringFromUnknown(job.seconds) ??
    optionalSecondsConfig(context.node.config.seconds);

  return {
    id: context.artifactId,
    label: context.node.title,
    nodeId: context.node.id,
    portId: context.outputPortId,
    preview: `data:${content.mediaType};base64,${base64FromBytes(content.bytes)}`,
    type: videoOutputType(context.outputType),
    value: {
      adapterId: "openai-video",
      model: stringFromUnknown(job.model) ?? model,
      provider: "openai",
      ...(seconds ? { seconds } : {}),
      ...(size ? { size } : {}),
      source: "binary",
      videoId: job.id,
    },
  };
}

function reportVideoJobProgress(
  context: WorkflowProviderExecutionContext,
  job: OpenAIVideoJob,
): void {
  if (job.status === "queued") {
    context.reportProgress({ message: "OpenAI video queued", progress: 0.15 });
    return;
  }
  if (job.status === "in_progress") {
    const progress = normalizeProgress(job.progress);
    context.reportProgress({
      message: `OpenAI video ${Math.round(progress * 100)}%`,
      progress,
    });
    return;
  }
  if (job.status === "completed") {
    context.reportProgress({
      message: "OpenAI video completed",
      progress: 0.9,
    });
  }
}

function requireVideoJob(value: unknown): OpenAIVideoJob {
  if (!isRecord(value)) throw new Error("OpenAI video response was invalid");
  const job = value as OpenAIVideoJob;
  if (!job.id)
    throw new Error("OpenAI video response did not include a job id");
  return job;
}

function promptForVideoGeneration(
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
    throw new Error("OpenAI video generation requires a text prompt");
  }
  return resolved.trim();
}

function imageReferenceForVideoGeneration(
  context: WorkflowProviderExecutionContext,
): string | null {
  const imageArtifact = context.inputArtifacts.find(
    (artifact) => artifact.type === "image",
  );
  const preview = imageArtifact?.preview?.trim();
  if (!preview) return null;
  if (/^https?:\/\//i.test(preview)) return preview;
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(preview)) return preview;
  return null;
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

function videoOutputType(outputType: WorkflowPortType): WorkflowPortType {
  return outputType === "video" ? outputType : "video";
}

function optionalSecondsConfig(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return optionalStringConfig(value);
}

function optionalStringConfig(value: unknown): string | null {
  const resolved = stringFromUnknown(value);
  return resolved && resolved.length > 0 ? resolved : null;
}

function stringConfig(value: unknown, fallback: string): string {
  return optionalStringConfig(value) ?? fallback;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : null;
}

function normalizeProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.25;
  return Math.min(Math.max(value / 100, 0.2), 0.9);
}

function mediaTypeFromResponse(response: Response): string | null {
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType || null;
}

function optionsSignal(
  _options: OpenAIVideoWorkflowProviderAdapterOptions,
): AbortSignal | undefined {
  return undefined;
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, Math.max(0, milliseconds));
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  const error = new Error("Execution cancelled");
  error.name = "AbortError";
  return error;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
