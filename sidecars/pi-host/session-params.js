import { constants as fsConstants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { SessionProtocolError } from "./session-errors.js";
import { isWithinWorkspace } from "./tool-policy.js";

export const INVALID_PARAMS = -32602;
export const SESSION_FILE_NOT_FOUND = -32009;

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function assertParamsObject(params, method) {
  if (params === undefined) {
    return {};
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} params must be an object`,
    );
  }
  return params;
}

export function requiredString(params, key, method) {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} requires a non-empty ${key}`,
    );
  }
  return value.trim();
}

export function optionalString(params, key, method) {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

export function titleFromPrompt(prompt) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 56) {
    return normalized;
  }
  return `${normalized.slice(0, 55).trimEnd()}…`;
}

export function optionalContextString(params, key, method) {
  const value = optionalString(params, key, method);
  if (value === undefined) {
    return undefined;
  }
  if (/\r|\n/.test(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must not contain newlines`,
    );
  }
  return value;
}

export function optionalThinkingLevel(params, key, method) {
  const value = optionalContextString(params, key, method);
  if (value === undefined) {
    return undefined;
  }
  if (!THINKING_LEVELS.has(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} is not supported: ${value}`,
    );
  }
  return value;
}

export function normalizeWorkspaceEnv(value, method) {
  if (value === undefined || value === null) {
    return { kind: "local" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} workspaceEnv must be an object`,
    );
  }
  if (value.kind === "local") {
    return { kind: "local" };
  }
  if (value.kind === "wsl") {
    if (typeof value.distro !== "string" || value.distro.trim() === "") {
      throw new SessionProtocolError(
        INVALID_PARAMS,
        `${method} workspaceEnv.distro must be a non-empty string`,
      );
    }
    const distro = value.distro.trim();
    if (/\r|\n/.test(distro)) {
      throw new SessionProtocolError(
        INVALID_PARAMS,
        `${method} workspaceEnv.distro must not contain newlines`,
      );
    }
    return { kind: "wsl", distro };
  }
  throw new SessionProtocolError(
    INVALID_PARAMS,
    `${method} workspaceEnv.kind is not supported: ${String(value.kind)}`,
  );
}

function assertBoolean(params, key, method) {
  const value = params[key];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must be a boolean`,
    );
  }
  return value;
}

export function compactContext(context) {
  if (context === undefined) {
    return undefined;
  }
  const result = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

export function normalizePromptContext(rawContext, method) {
  if (rawContext === undefined || rawContext === null) {
    return undefined;
  }
  if (typeof rawContext !== "object" || Array.isArray(rawContext)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} context must be an object`,
    );
  }
  return compactContext({
    workspaceRoot: optionalContextString(rawContext, "workspaceRoot", method),
    activeTerminalCwd: optionalContextString(
      rawContext,
      "activeTerminalCwd",
      method,
    ),
    activeFile: optionalContextString(rawContext, "activeFile", method),
    activeTerminalPrivate: assertBoolean(
      rawContext,
      "activeTerminalPrivate",
      method,
    ),
  });
}

async function assertReadableRegularFile(path, method, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw new SessionProtocolError(
        SESSION_FILE_NOT_FOUND,
        `${method} ${label} was not found: ${path}`,
      );
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new SessionProtocolError(
      SESSION_FILE_NOT_FOUND,
      `${method} ${label} must be a readable regular file: ${path}`,
    );
  }
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new SessionProtocolError(
      SESSION_FILE_NOT_FOUND,
      `${method} ${label} is not readable: ${path}`,
    );
  }
}

export async function assertResumeSessionFile(sdkSessionFile, sessionDir) {
  const method = "sessions.resume";
  if (!isAbsolute(sdkSessionFile)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} sdkSessionFile must be an absolute path`,
    );
  }
  if (!isAbsolute(sessionDir)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} sessionDir must be an absolute path`,
    );
  }
  if (!isWithinWorkspace(sessionDir, sdkSessionFile)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} sdkSessionFile must stay inside sessionDir`,
    );
  }
  await assertReadableRegularFile(sdkSessionFile, method, "sdkSessionFile");
}
