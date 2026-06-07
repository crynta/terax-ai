import { FALLBACK_CAPABILITY_MANIFEST } from "./fallback-capability-manifest.js";

export const RUST_MEDIATED_TOOL_NAMES = FALLBACK_CAPABILITY_MANIFEST.tools
  .filter((tool) => tool.modelVisible !== false && tool.approval !== "deny")
  .map((tool) => tool.name);

let nativeToolExecutor = async () => {
  throw new Error("Terax native tool bridge is not connected");
};

export function setNativeToolExecutor(executor) {
  if (typeof executor !== "function") {
    throw new TypeError("native tool executor must be a function");
  }
  nativeToolExecutor = executor;
}

export function setNativeToolExecutorForTests(executor) {
  setNativeToolExecutor(executor);
}

export function resetNativeToolExecutorForTests() {
  nativeToolExecutor = async () => {
    throw new Error("Terax native tool bridge is not connected");
  };
}

function withAbortSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new Error("Operation aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Operation aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function normalizeTextPart(part) {
  if (part && typeof part === "object" && part.type === "text") {
    return { type: "text", text: String(part.text ?? "") };
  }
  return { type: "text", text: String(part ?? "") };
}

function normalizeToolResult(result) {
  if (!result || typeof result !== "object") {
    return {
      content: [{ type: "text", text: String(result ?? "") }],
      details: null,
    };
  }
  return {
    content: Array.isArray(result.content)
      ? result.content.map(normalizeTextPart)
      : [{ type: "text", text: String(result.content ?? "") }],
    details: result.details ?? null,
  };
}

export function executeNativeTool(request, signal) {
  const toolCall = nativeToolExecutor(request, signal);
  return withAbortSignal(
    Promise.resolve(toolCall).then(normalizeToolResult),
    signal,
  );
}

function isVisibleManifestTool(tool) {
  return (
    tool &&
    typeof tool === "object" &&
    typeof tool.name === "string" &&
    tool.name.trim() !== "" &&
    tool.modelVisible !== false &&
    tool.approval !== "deny"
  );
}

function definitionFromManifestTool(tool) {
  const name = tool.name.trim();
  return {
    name,
    label:
      typeof tool.label === "string" && tool.label.trim() !== ""
        ? tool.label
        : name,
    description:
      typeof tool.description === "string" ? tool.description : "Terax tool",
    promptSnippet:
      typeof tool.promptSnippet === "string" ? tool.promptSnippet : undefined,
    promptGuidelines: Array.isArray(tool.promptGuidelines)
      ? tool.promptGuidelines.filter((item) => typeof item === "string")
      : undefined,
    parameters:
      tool.parameters && typeof tool.parameters === "object"
        ? tool.parameters
        : { type: "object", properties: {}, required: [] },
    approval: typeof tool.approval === "string" ? tool.approval : undefined,
    risk: typeof tool.risk === "string" ? tool.risk : undefined,
    origin: typeof tool.origin === "string" ? tool.origin : undefined,
  };
}

function approvalMetadata(definition) {
  if (typeof definition.approval !== "string") return undefined;
  return {
    policy: definition.approval,
    approved: definition.approval !== "deny",
    ...(definition.risk ? { risk: definition.risk } : {}),
    ...(definition.origin ? { origin: definition.origin } : {}),
  };
}

function toolDefinitionsForSession(session) {
  const manifestTools = session?.capabilityManifest?.tools;
  if (Array.isArray(manifestTools)) {
    return manifestTools
      .filter(isVisibleManifestTool)
      .map(definitionFromManifestTool);
  }
  return FALLBACK_CAPABILITY_MANIFEST.tools
    .filter(isVisibleManifestTool)
    .map(definitionFromManifestTool);
}

export function createTeraxNativeToolDefinitions(_pi, session) {
  return toolDefinitionsForSession(session).map((definition) => {
    const toolName = definition.name;
    return {
      ...definition,
      async execute(toolCallId, input, signal, onUpdate) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Routing ${toolName} through Terax Rust…`,
            },
          ],
        });
        const approval = approvalMetadata(definition);
        return executeNativeTool(
          {
            sessionId: session.id,
            toolCallId,
            toolName,
            cwd: session.cwd,
            workspaceEnv: session.workspaceEnv ?? { kind: "local" },
            ...(approval ? { approval } : {}),
            input,
          },
          signal,
        );
      },
    };
  });
}
