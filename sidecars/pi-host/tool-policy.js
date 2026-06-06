import { homedir } from "node:os";
import {
  basename,
  isAbsolute,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import { RUST_MEDIATED_TOOL_NAMES } from "./native-tools.js";

export const APPROVAL_TOOL_NAMES = ["bash", "edit", "write"];
export const ENABLED_TOOL_NAMES = RUST_MEDIATED_TOOL_NAMES;
export const TOOL_MODE = "rust-mediated";

const APPROVAL_REQUIRED_TOOLS = new Set(APPROVAL_TOOL_NAMES);
const PATH_PARAMETER_NAMES = new Set([
  "path",
  "from",
  "to",
  "sourcePath",
  "destinationPath",
]);
const FILE_TOOL_KINDS = new Set([
  "file-read",
  "file-list",
  "file-search",
  "file-write",
]);

// Sidecar checks are deliberately a preflight UX mirror. Rust PathPolicy is the
// authority for workspace containment, traversal, symlinks, and sensitive paths.
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".netrc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

function visibleManifestTools(session) {
  const tools = session?.capabilityManifest?.tools;
  if (!Array.isArray(tools)) return null;
  return tools.filter(
    (tool) =>
      tool &&
      typeof tool === "object" &&
      typeof tool.name === "string" &&
      tool.name.trim() !== "" &&
      tool.modelVisible !== false &&
      tool.approval !== "deny",
  );
}

function manifestToolForSession(session, toolName) {
  const tools = visibleManifestTools(session);
  if (!tools) return null;
  return tools.find((tool) => tool.name.trim() === toolName) ?? null;
}

export function enabledToolNamesForSession(session) {
  const tools = visibleManifestTools(session);
  if (!tools) return [...ENABLED_TOOL_NAMES];
  return tools.map((tool) => tool.name.trim());
}

export function approvalToolNamesForSession(session) {
  const tools = visibleManifestTools(session);
  if (!tools) return [...APPROVAL_TOOL_NAMES];
  return tools
    .filter((tool) => tool.approval === "ask")
    .map((tool) => tool.name.trim());
}

function expandHomePath(value) {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`)) {
    return resolvePath(homedir(), value.slice(2));
  }
  return value;
}

function resolveToolPath(cwd, value) {
  const expanded = expandHomePath(String(value ?? ".").trim() || ".");
  return isAbsolute(expanded)
    ? resolvePath(expanded)
    : resolvePath(cwd, expanded);
}

export function isWithinWorkspace(workspaceRoot, candidatePath) {
  const relativePath = relative(
    resolvePath(workspaceRoot),
    resolvePath(candidatePath),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isSensitivePath(candidatePath) {
  const parts = resolvePath(candidatePath).split(/[\\/]+/);
  if (parts.some((part) => part === ".ssh" || part === ".gnupg")) {
    return true;
  }
  const name = basename(candidatePath).toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  return /(?:^|[._-])(secret|secrets|credential|credentials|token|tokens|private-key)(?:[._-]|$)/i.test(
    name,
  );
}

function fallbackToolPathInputs(toolName, args) {
  if (!args || typeof args !== "object") return [];
  switch (toolName) {
    case "read":
    case "edit":
    case "write":
      return typeof args.path === "string" ? [args.path] : [];
    case "ls":
    case "grep":
    case "find":
      return typeof args.path === "string" ? [args.path] : ["."];
    default:
      return [];
  }
}

function isWorkspaceScopedManifestTool(tool) {
  const scopes = Array.isArray(tool?.scopes) ? tool.scopes : [];
  return scopes.includes("workspace") || FILE_TOOL_KINDS.has(tool?.kind);
}

function manifestPathInputs(tool, args) {
  if (!args || typeof args !== "object" || !isWorkspaceScopedManifestTool(tool)) {
    return [];
  }

  const parameters = tool?.parameters;
  const properties = parameters?.properties;
  if (!properties || typeof properties !== "object") return [];

  const required = new Set(
    Array.isArray(parameters.required) ? parameters.required : [],
  );
  const paths = [];
  for (const name of Object.keys(properties)) {
    if (!PATH_PARAMETER_NAMES.has(name)) continue;
    const value = args[name];
    if (typeof value === "string") {
      paths.push(value);
    } else if (name === "path" && !required.has(name)) {
      paths.push(".");
    }
  }
  return paths;
}

function toolPathInputs(session, toolName, args) {
  if (session?.capabilityManifest) {
    const tool = manifestToolForSession(session, toolName);
    return tool ? manifestPathInputs(tool, args) : [];
  }
  return fallbackToolPathInputs(toolName, args);
}

export function validateToolSafety(session, toolName, args) {
  const rawPaths = toolPathInputs(session, toolName, args);
  if (rawPaths.length === 0) {
    return null;
  }

  for (const rawPath of rawPaths) {
    const resolvedPath = resolveToolPath(session.cwd, rawPath);
    if (!isWithinWorkspace(session.cwd, resolvedPath)) {
      return `${toolName} can only access files inside the workspace: ${session.cwd}`;
    }
    if (isSensitivePath(resolvedPath)) {
      return `${toolName} refused sensitive path: ${rawPath}`;
    }
  }
  return null;
}

export function toolRequiresApproval(toolName, session = null) {
  if (session?.capabilityManifest) {
    return approvalToolNamesForSession(session).includes(toolName);
  }
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}
