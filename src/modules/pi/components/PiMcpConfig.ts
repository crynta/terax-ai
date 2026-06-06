import type {
  McpServerConfig,
  McpStoredServerConfig,
  McpTransport,
} from "@/modules/pi/lib/native";

export type McpConfigDraft = {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  cwd: string;
  url: string;
  oauthTokenEnv: string;
  envNamesText: string;
};

type McpConfigBuildResult =
  | { ok: true; config: McpServerConfig }
  | { ok: false; error: string };

export const EMPTY_MCP_CONFIG_DRAFT: McpConfigDraft = {
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  argsText: "",
  cwd: "",
  url: "",
  oauthTokenEnv: "",
  envNamesText: "",
};

const MCP_ALLOWED_COMMAND_NAMES = [
  "node",
  "npx",
  "npm",
  "pnpm",
  "bun",
  "deno",
  "uvx",
  "uv",
  "python",
  "python3",
];

function splitNonEmptyLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitEnvNames(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function validServerId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function validEnvName(value: string): boolean {
  return /^[A-Za-z0-9_]{1,128}$/.test(value);
}

function isAbsoluteCommandPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function validateCommand(value: string): string | null {
  if (value.includes("/") || value.includes("\\")) {
    return isAbsoluteCommandPath(value)
      ? null
      : "Command must be an absolute path or an allowlisted command name.";
  }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    return "Command contains unsupported characters.";
  }
  if (!MCP_ALLOWED_COMMAND_NAMES.includes(value)) {
    return `Command must be an absolute path or allowlisted command: ${MCP_ALLOWED_COMMAND_NAMES.join(", ")}.`;
  }
  return null;
}

export function draftFromStoredMcpConfig(
  config: McpStoredServerConfig,
): McpConfigDraft {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport ?? "stdio",
    command: config.command,
    argsText: config.args.join("\n"),
    cwd: config.cwd ?? "",
    url: config.url ?? "",
    oauthTokenEnv: config.oauthTokenEnv ?? "",
    envNamesText: config.env.map((item) => item.name).join("\n"),
  };
}

export function buildMcpServerConfigFromDraft(
  draft: McpConfigDraft,
): McpConfigBuildResult {
  const id = draft.id.trim();
  if (!validServerId(id)) {
    return {
      ok: false,
      error: "Server id must use 1-64 letters, numbers, _ or -.",
    };
  }

  const transport = draft.transport;
  const command = draft.command.trim();
  const url = draft.url.trim();
  if (transport === "stdio") {
    if (command.length === 0) {
      return { ok: false, error: "Command is required." };
    }
    if (command.length > 4096 || /[\u0000-\u001F\u007F]/.test(command)) {
      return { ok: false, error: "Command contains unsupported characters." };
    }
    const commandError = validateCommand(command);
    if (commandError) {
      return { ok: false, error: commandError };
    }
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "HTTP MCP URL must use http or https." };
      }
      if (parsed.username || parsed.password) {
        return {
          ok: false,
          error: "HTTP MCP URL must not include credentials.",
        };
      }
    } catch {
      return { ok: false, error: "HTTP MCP URL is invalid." };
    }
  }

  const name = draft.name.trim() || id;
  const args = transport === "stdio" ? splitNonEmptyLines(draft.argsText) : [];
  const cwd = transport === "stdio" ? draft.cwd.trim() : "";
  const envNames: string[] = [];
  const oauthTokenEnv = draft.oauthTokenEnv.trim();
  const envDraft = [draft.envNamesText, oauthTokenEnv]
    .filter(Boolean)
    .join("\n");
  for (const rawName of splitEnvNames(envDraft)) {
    if (rawName.includes("=")) {
      return {
        ok: false,
        error:
          "Environment entries must be names only. Store values outside Terax.",
      };
    }
    if (rawName.startsWith("TERAX_")) {
      return { ok: false, error: "TERAX_ environment names are reserved." };
    }
    if (!validEnvName(rawName)) {
      return {
        ok: false,
        error: "Environment names may only use letters, numbers, and _.",
      };
    }
    if (!envNames.includes(rawName)) {
      envNames.push(rawName);
    }
  }

  return {
    ok: true,
    config: {
      id,
      name,
      transport,
      command: transport === "stdio" ? command : "",
      args,
      cwd: cwd.length > 0 ? cwd : null,
      url: transport === "http" ? url : null,
      oauthTokenEnv: oauthTokenEnv.length > 0 ? oauthTokenEnv : null,
      env: envNames.map((envName) => ({ name: envName, value: "" })),
    },
  };
}
