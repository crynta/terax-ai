import type { UIMessage, UIMessageChunk } from "ai";
import type { ProviderId } from "../config";

export type ResponsesReasoningIssuer = "openai_api" | "codex_backend";

type MetadataRecord = Record<string, unknown>;
type ReasoningChunk = Extract<
  UIMessageChunk,
  { type: "reasoning-start" | "reasoning-delta" | "reasoning-end" }
>;

export function responsesIssuerForProvider(
  provider: ProviderId,
): ResponsesReasoningIssuer | null {
  if (provider === "openai") return "openai_api";
  if (provider === "openai-codex") return "codex_backend";
  return null;
}

export function filterReasoningForIssuer<T extends UIMessage>(
  messages: readonly T[],
  issuer: ResponsesReasoningIssuer,
): T[] {
  let changed = false;
  const next = messages.map((message) => {
    let partsChanged = false;
    const parts = message.parts.filter((part) => {
      if (part.type !== "reasoning") return true;
      const partIssuer = readResponsesIssuer(part.providerMetadata);
      const keep =
        partIssuer === issuer ||
        (partIssuer == null && issuer === "openai_api");
      if (!keep) partsChanged = true;
      return keep;
    });

    if (!partsChanged) return message;
    changed = true;
    return { ...message, parts } as T;
  });
  return changed ? next : [...messages];
}

export function tagReasoningIssuerInStream<T extends UIMessageChunk>(
  stream: ReadableStream<T>,
  issuer: ResponsesReasoningIssuer | null,
): ReadableStream<T> {
  if (!issuer) return stream;
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        controller.enqueue(tagReasoningChunkIssuer(chunk, issuer));
      },
    }),
  );
}

export function tagReasoningChunkIssuer<T extends UIMessageChunk>(
  chunk: T,
  issuer: ResponsesReasoningIssuer,
): T {
  if (!isReasoningChunk(chunk)) return chunk;
  return {
    ...chunk,
    providerMetadata: withResponsesIssuer(chunk.providerMetadata, issuer),
  } as T;
}

function isReasoningChunk(chunk: UIMessageChunk): chunk is ReasoningChunk {
  return (
    chunk.type === "reasoning-start" ||
    chunk.type === "reasoning-delta" ||
    chunk.type === "reasoning-end"
  );
}

function withResponsesIssuer(
  providerMetadata: unknown,
  issuer: ResponsesReasoningIssuer,
): MetadataRecord {
  const metadata = isRecord(providerMetadata) ? providerMetadata : {};
  const terax = isRecord(metadata.terax) ? metadata.terax : {};
  return {
    ...metadata,
    terax: {
      ...terax,
      responsesIssuer: issuer,
    },
  };
}

function readResponsesIssuer(
  providerMetadata: unknown,
): ResponsesReasoningIssuer | null {
  if (!isRecord(providerMetadata)) return null;
  const terax = providerMetadata.terax;
  if (!isRecord(terax)) return null;
  const issuer = terax.responsesIssuer;
  return issuer === "openai_api" || issuer === "codex_backend"
    ? issuer
    : null;
}

function isRecord(value: unknown): value is MetadataRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
