import { join } from "node:path";
import { SessionProtocolError } from "./session-errors.js";

const INVALID_PARAMS = -32602;

function protocolError(message) {
  return new SessionProtocolError(INVALID_PARAMS, message);
}

function assertPlainObject(value, name) {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(`${name} must be an object`);
  }
  return value;
}

function requiredString(raw, key) {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw protocolError(`${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (/\r|\n/.test(trimmed)) {
    throw protocolError(`${key} must not contain newlines`);
  }
  return trimmed;
}

function safeNumber(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

export async function listProfileModels(pi, rawOptions) {
  const options = assertPlainObject(rawOptions, "models.list params");
  const profileAgentDir = requiredString(options, "profileAgentDir");
  const authStorage = pi.AuthStorage.create(join(profileAgentDir, "auth.json"));
  const modelRegistry = pi.ModelRegistry.create(
    authStorage,
    join(profileAgentDir, "models.json"),
  );

  return {
    profileAgentDir,
    loadError: modelRegistry.getError?.() ?? null,
    models: modelRegistry.getAll().map((model) => ({
      provider: model.provider,
      providerLabel: modelRegistry.getProviderDisplayName(model.provider),
      id: model.id,
      label: model.name ?? model.id,
      available: modelRegistry.hasConfiguredAuth(model),
      contextWindow: safeNumber(model.contextWindow),
      maxTokens: safeNumber(model.maxTokens),
      reasoning: model.reasoning === true,
    })),
  };
}
