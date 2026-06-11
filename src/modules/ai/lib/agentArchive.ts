import type { UIMessage as AIUIMessage } from "ai";

const MAX_ACTIVE_PAIRS = 8;
const MAX_ARCHIVE_CHARS = 2400;

function getTextContent(msg: AIUIMessage): string {
  if ("content" in msg && typeof msg.content === "string") {
    return msg.content;
  }
  if ("parts" in msg && Array.isArray(msg.parts)) {
    return (msg.parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

export type ArchiveResult = {
  active: AIUIMessage[];
  archive: string;
};

export function compactIfNeeded(messages: AIUIMessage[]): ArchiveResult {
  if (messages.length <= MAX_ACTIVE_PAIRS * 2) {
    return { active: messages, archive: "" };
  }

  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const pairs = Math.min(userMessages.length, assistantMessages.length);
  const keepPairs = Math.min(pairs, MAX_ACTIVE_PAIRS);

  const splitAt = messages.length - keepPairs * 2;
  const archived = messages.slice(0, splitAt);
  const active = messages.slice(splitAt);

  const archiveParts: string[] = [];
  for (const msg of archived) {
    const label = msg.role === "user" ? "User" : "Assistant";
    const content = getTextContent(msg);
    const truncated =
      content.length > 200 ? `${content.slice(0, 200)}...` : content;
    archiveParts.push(`**${label}:** ${truncated}`);
  }

  let archive = archiveParts.join("\n\n");
  if (archive.length > MAX_ARCHIVE_CHARS) {
    archive = `${archive.slice(0, MAX_ARCHIVE_CHARS)}\n\n[... earlier messages archived ...]`;
  }

  return { active, archive };
}
