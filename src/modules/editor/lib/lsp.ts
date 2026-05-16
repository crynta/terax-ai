import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";

type WorkspaceEnv =
  | { kind: "local" }
  | { kind: "wsl"; distro: string }
  | { kind: "ssh"; profileId: string };

export type LspServerConfig = {
  languageId: string;
  command: string;
  args: string[];
  extensions: string[];
};

export type LspDiagnostic = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  severity?: number;
  message: string;
  source?: string;
  code?: string;
};

export type LspDiagnosticsResponse = {
  version: number;
  diagnostics: LspDiagnostic[];
};

export type LspHoverResponse = {
  contents: string;
};

export type LspDefinitionResponse = {
  uri: string;
  line: number;
  character: number;
};

const ROOT_MARKERS: Record<string, string[]> = {
  typescript: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
  python: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", ".git"],
  rust: ["Cargo.toml", "rust-project.json", ".git"],
  go: ["go.work", "go.mod", ".git"],
};

const SERVER_CONFIGS: LspServerConfig[] = [
  {
    languageId: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
  },
  {
    languageId: "python",
    command: "pylsp",
    args: [],
    extensions: ["py"],
  },
  {
    languageId: "rust",
    command: "rust-analyzer",
    args: [],
    extensions: ["rs"],
  },
  {
    languageId: "go",
    command: "gopls",
    args: [],
    extensions: ["go"],
  },
];

export function getLspServerConfig(path: string): LspServerConfig | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return SERVER_CONFIGS.find((config) => config.extensions.includes(ext)) ?? null;
}

export function getLspDocumentLanguageId(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    default:
      return null;
  }
}

export async function getLspRootPath(path: string, languageId: string): Promise<string> {
  let current = parentPath(path);
  const markers = ROOT_MARKERS[languageId] ?? [".git"];

  while (current) {
    for (const marker of markers) {
      if (await pathExists(joinPath(current, marker))) {
        return current;
      }
    }
    const parent = parentPath(current);
    if (!parent || parent === current) break;
    current = parent;
  }

  return parentPath(path) ?? path;
}

export async function lspStart(
  command: string,
  args: string[],
  rootPath: string,
  workspace: WorkspaceEnv,
): Promise<number> {
  return invoke<number>("lsp_start", {
    request: { command, args, rootPath, workspace },
  });
}

export async function lspOpen(
  handle: number,
  path: string,
  languageId: string,
  text: string,
): Promise<void> {
  return invoke("lsp_open", {
    request: { handle, path, languageId, text },
  });
}

export async function lspChange(
  handle: number,
  path: string,
  text: string,
): Promise<void> {
  return invoke("lsp_change", {
    request: { handle, path, text },
  });
}

export async function lspClose(handle: number, path: string): Promise<void> {
  return invoke("lsp_close", {
    request: { handle, path },
  });
}

export async function lspSave(
  handle: number,
  path: string,
  text: string,
): Promise<void> {
  return invoke("lsp_save", {
    request: { handle, path, text },
  });
}

export async function lspReadDiagnostics(
  handle: number,
  path: string,
): Promise<LspDiagnosticsResponse> {
  return invoke<LspDiagnosticsResponse>("lsp_read_diagnostics", {
    request: { handle, path },
  });
}

export async function lspHover(
  handle: number,
  path: string,
  line: number,
  character: number,
): Promise<LspHoverResponse | null> {
  return invoke<LspHoverResponse | null>("lsp_hover", {
    request: { handle, path, line, character },
  });
}

export async function lspDefinition(
  handle: number,
  path: string,
  line: number,
  character: number,
): Promise<LspDefinitionResponse | null> {
  return invoke<LspDefinitionResponse | null>("lsp_definition", {
    request: { handle, path, line, character },
  });
}

export async function lspStop(handle: number): Promise<void> {
  return invoke("lsp_stop", { handle });
}

export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;

  try {
    const decoded = decodeURIComponent(uri.slice("file://".length));
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await invoke("fs_stat", { path, workspace: currentWorkspaceEnv() });
    return true;
  } catch {
    return false;
  }
}

function parentPath(path: string): string | null {
  const normalized = path.replace(/\\+/g, "/");
  const trimmed = normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash < 0) return null;
  if (lastSlash === 0) return "/";
  if (/^[a-zA-Z]:$/.test(trimmed.slice(0, lastSlash))) {
    return `${trimmed.slice(0, lastSlash)}/`;
  }
  return trimmed.slice(0, lastSlash);
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment}`;
}
