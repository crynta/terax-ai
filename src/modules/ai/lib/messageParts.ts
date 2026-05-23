import type { ModelMessage } from "ai";

type FileLikePart = {
  type: string;
  data?: unknown;
  mediaType?: string;
};

type ParsedDataUrl = {
  mediaType: string | undefined;
  base64: string;
};

function parseBase64DataUrl(value: string): ParsedDataUrl | null {
  if (!value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma === -1) return null;
  const header = value.slice(5, comma);
  if (!/(^|;)base64($|;)/i.test(header)) return null;
  const mediaType = header.split(";")[0] || undefined;
  const base64 = value.slice(comma + 1);
  return base64 ? { mediaType, base64 } : null;
}

function normalizeFilePart(part: unknown): unknown {
  const candidate = part as FileLikePart;
  if (candidate?.type !== "file" || typeof candidate.data !== "string") {
    return part;
  }
  const parsed = parseBase64DataUrl(candidate.data);
  if (!parsed) return part;
  return {
    ...candidate,
    data: parsed.base64,
    mediaType: parsed.mediaType ?? candidate.mediaType,
  };
}

export function normalizeDataUrlFileParts(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map(normalizeFilePart),
    } as ModelMessage;
  });
}
