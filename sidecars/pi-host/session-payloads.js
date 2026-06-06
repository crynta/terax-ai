export function payloadWithActiveBranch(session, payload) {
  return session.activeBranch === undefined
    ? payload
    : { ...payload, branch: session.activeBranch };
}

export function toolPayload(session, payload) {
  return payloadWithActiveBranch(session, payload);
}

export function serializableValue(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function compactToolResult(result) {
  if (!result || typeof result !== "object") {
    return { content: String(result ?? ""), details: null };
  }

  const content = Array.isArray(result.content)
    ? result.content
        .map((part) => {
          if (part?.type === "text") return String(part.text ?? "");
          if (part?.type === "image") return "[image output omitted]";
          return `[${String(part?.type ?? "unknown")} output omitted]`;
        })
        .filter((part) => part.length > 0)
        .join("\n")
    : "";
  return {
    content,
    details: serializableValue(result.details) ?? null,
  };
}

export function toolResultText(result) {
  const compact = compactToolResult(result);
  return compact.content || "Tool completed.";
}

export function outputPayload(session, text) {
  return session.activeBranch === undefined
    ? { text }
    : { text, branch: session.activeBranch };
}

export function branchPayload(branch) {
  const payload = {
    groupId: branch.groupId,
    index: branch.index,
  };
  if (branch.regeneratedFromEventId) {
    payload.regeneratedFromEventId = branch.regeneratedFromEventId;
  }
  return payload;
}
