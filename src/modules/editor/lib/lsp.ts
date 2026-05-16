import { invoke } from "@tauri-apps/api/core";

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

export function getLspRootPath(path: string): string {
  const normalized = path.replace(/\\+/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return path;
  return path.slice(0, lastSlash);
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

export async function lspStop(handle: number): Promise<void> {
  return invoke("lsp_stop", { handle });
}