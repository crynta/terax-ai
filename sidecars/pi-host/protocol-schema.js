export const PROTOCOL_VERSION = 2;

const emptyParams = () => ({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const objectParam = (options = {}) => ({ type: "object", ...options });
const stringParam = (options = {}) => ({ type: "string", ...options });
const booleanParam = (options = {}) => ({ type: "boolean", ...options });
const integerParam = (options = {}) => ({ type: "integer", ...options });
const thinkingLevelParam = (options = {}) => ({
  type: "string",
  enum: ["off", "minimal", "low", "medium", "high", "xhigh"],
  ...options,
});
const promptContextParam = (options = {}) => ({
  type: "object",
  properties: {
    workspaceRoot: stringParam({
      minLength: 1,
      noNewline: true,
      nullable: true,
    }),
    activeTerminalCwd: stringParam({
      minLength: 1,
      noNewline: true,
      nullable: true,
    }),
    activeFile: stringParam({ minLength: 1, noNewline: true, nullable: true }),
    activeTerminalPrivate: booleanParam(),
  },
  additionalProperties: false,
  ...options,
});
const workspaceEnvParam = (options = {}) => ({
  type: "object",
  discriminator: "kind",
  variants: {
    local: methodParams({ kind: stringParam({ enum: ["local"] }) }, ["kind"]),
    wsl: methodParams(
      {
        kind: stringParam({ enum: ["wsl"] }),
        distro: stringParam({ minLength: 1, noNewline: true }),
      },
      ["kind", "distro"],
    ),
  },
  ...options,
});

function methodParams(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export const PI_HOST_PROTOCOL_SCHEMA = Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  jsonrpc: "2.0",
  methods: {
    ping: methodParams({
      protocolVersion: integerParam({ minimum: 1 }),
    }),
    status: emptyParams(),
    info: emptyParams(),
    diagnostics: emptyParams(),
    "models.list": methodParams(
      { profileAgentDir: stringParam({ minLength: 1, noNewline: true }) },
      ["profileAgentDir"],
    ),
    "sessions.list": emptyParams(),
    "sessions.create": methodParams({
      title: stringParam({ minLength: 1, nullable: true }),
      cwd: stringParam({ minLength: 1, nullable: true }),
      providerConfig: objectParam({ nullable: true }),
      sessionDir: stringParam({ minLength: 1, nullable: true }),
      workspaceEnv: workspaceEnvParam({ nullable: true }),
      capabilityManifest: objectParam({ nullable: true }),
    }),
    "sessions.configure": methodParams(
      {
        sessionId: stringParam({ minLength: 1 }),
        capabilityManifest: objectParam({ nullable: true }),
      },
      ["sessionId", "capabilityManifest"],
    ),
    "sessions.send": methodParams(
      {
        sessionId: stringParam({ minLength: 1 }),
        prompt: stringParam({ minLength: 1 }),
        context: promptContextParam({ nullable: true }),
        regenerateBranchGroupId: stringParam({
          minLength: 1,
          noNewline: true,
          nullable: true,
        }),
        thinkingLevel: thinkingLevelParam({ nullable: true }),
      },
      ["sessionId", "prompt"],
    ),
    "sessions.resume": methodParams(
      {
        sessionId: stringParam({ minLength: 1 }),
        title: stringParam({ minLength: 1, nullable: true }),
        cwd: stringParam({ minLength: 1 }),
        sdkSessionFile: stringParam({ minLength: 1 }),
        sessionDir: stringParam({ minLength: 1, nullable: true }),
        providerConfig: objectParam({ nullable: true }),
        createdAt: stringParam({
          minLength: 1,
          noNewline: true,
          nullable: true,
        }),
        lastPrompt: stringParam({ nullable: true }),
        thinkingLevel: thinkingLevelParam({ nullable: true }),
        workspaceEnv: workspaceEnvParam({ nullable: true }),
        capabilityManifest: objectParam({ nullable: true }),
      },
      ["sessionId", "cwd", "sdkSessionFile", "sessionDir"],
    ),
    "sessions.tool.respond": methodParams(
      {
        sessionId: stringParam({ minLength: 1 }),
        toolCallId: stringParam({ minLength: 1 }),
        approved: booleanParam(),
      },
      ["sessionId", "toolCallId", "approved"],
    ),
    "sessions.rename": methodParams(
      {
        sessionId: stringParam({ minLength: 1 }),
        title: stringParam({ minLength: 1 }),
      },
      ["sessionId", "title"],
    ),
    "sessions.delete": methodParams(
      { sessionId: stringParam({ minLength: 1 }) },
      ["sessionId"],
    ),
    "sessions.stop": methodParams(
      { sessionId: stringParam({ minLength: 1 }) },
      ["sessionId"],
    ),
    shutdown: emptyParams(),
  },
});

export function protocolSchemaMethods() {
  return Object.keys(PI_HOST_PROTOCOL_SCHEMA.methods);
}

function typeName(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateString(value, schema, path) {
  if (typeof value !== "string") {
    return `${path} must be a string`;
  }
  if (
    schema.minLength !== undefined &&
    value.trim().length < schema.minLength
  ) {
    return `${path} must be a non-empty string`;
  }
  if (schema.noNewline && /\r|\n/.test(value)) {
    return `${path} must not contain newlines`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.join(", ")}`;
  }
  return null;
}

function validateInteger(value, schema, path) {
  if (!Number.isInteger(value)) {
    return `${path} must be an integer`;
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}`;
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return `${path} must be at most ${schema.maximum}`;
  }
  return null;
}

function validateObject(value, schema, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${path} must be an object`;
  }
  if (schema.variants) {
    const discriminator = schema.discriminator;
    const variantKey = value[discriminator];
    const variant = schema.variants[variantKey];
    if (!variant) {
      return `${path}.${discriminator} is not supported: ${String(variantKey)}`;
    }
    return validateObject(value, variant, path);
  }
  const properties = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (value[key] === undefined) {
      return `${path} requires ${key}`;
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (properties[key] === undefined) {
        return `${path} contains unsupported field: ${key}`;
      }
    }
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (value[key] === undefined) {
      continue;
    }
    if (value[key] === null && childSchema.nullable === true) {
      continue;
    }
    const error = validateValue(value[key], childSchema, `${path}.${key}`);
    if (error !== null) {
      return error;
    }
  }
  return null;
}

function validateValue(value, schema, path) {
  switch (schema.type) {
    case "object":
      return validateObject(value, schema, path);
    case "string":
      return validateString(value, schema, path);
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "integer":
      return validateInteger(value, schema, path);
    default:
      return `${path} has unsupported schema type: ${typeName(schema.type)}`;
  }
}

export function validateProtocolParams(method, rawParams) {
  const schema = PI_HOST_PROTOCOL_SCHEMA.methods[method];
  if (!schema) {
    return { ok: false, message: `No schema for Pi host method: ${method}` };
  }
  const params = rawParams === undefined ? {} : rawParams;
  const error = validateObject(params, schema, `${method} params`);
  if (error !== null) {
    return { ok: false, message: error };
  }
  return { ok: true, params };
}
