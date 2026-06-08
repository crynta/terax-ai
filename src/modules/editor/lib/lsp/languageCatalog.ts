/** Supported language groups — one row per LSP binary (Zed-style Languages settings). */
export type LspLanguageGroup = {
  id: string;
  label: string;
  extensions: string[];
  command: string;
  installHint: string;
  docsUrl?: string;
};

export const LSP_LANGUAGE_GROUPS: LspLanguageGroup[] = [
  {
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    command: "rust-analyzer",
    installHint: "Install for Terax downloads rust-analyzer into app data.",
    docsUrl: "https://rust-analyzer.github.io/",
  },
  {
    id: "typescript",
    label: "TypeScript & JavaScript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    command: "typescript-language-server",
    installHint: "Install for Terax includes a private Node.js runtime — no system Node required.",
    docsUrl: "https://github.com/typescript-language-server/typescript-language-server",
  },
  {
    id: "python",
    label: "Python",
    extensions: [".py"],
    command: "pyright-langserver",
    installHint: "Install for Terax includes pyright and a private Node.js runtime.",
    docsUrl: "https://github.com/microsoft/pyright",
  },
  {
    id: "go",
    label: "Go",
    extensions: [".go"],
    command: "gopls",
    installHint: "Install for Terax downloads gopls into app data.",
    docsUrl: "https://pkg.go.dev/golang.org/x/tools/gopls",
  },
  {
    id: "cpp",
    label: "C / C++",
    extensions: [".c", ".h", ".cpp", ".hpp"],
    command: "clangd",
    installHint: "Install for Terax downloads clangd into app data.",
    docsUrl: "https://clangd.llvm.org/installation",
  },
  {
    id: "php",
    label: "PHP",
    extensions: [".php", ".phtml"],
    command: "intelephense",
    installHint:
      "Install for Terax includes intelephense and a private Node.js runtime — no system Node required.",
    docsUrl: "https://intelephense.com/",
  },
  {
    id: "dependencies",
    label: "Dependencies (npm, Cargo, …)",
    extensions: [
      "package.json",
      "Cargo.toml",
      "pyproject.toml",
      "go.mod",
      "composer.json",
      "Gemfile",
      "pubspec.yaml",
    ],
    command: "deps-lsp",
    installHint:
      "Shows latest package versions in package.json and other manifest files (npm, Cargo, PyPI, Go, …).",
    docsUrl: "https://github.com/bug-ops/deps-lsp",
  },
  {
    id: "json",
    label: "JSON & config",
    extensions: [
      ".json",
      ".jsonc",
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      ".vscode/*.json",
    ],
    command: "vscode-json-language-server",
    installHint:
      "Validates tsconfig and other JSON config files (schemas, completions). package.json also uses Dependencies LSP for version hints.",
  },
  {
    id: "shell",
    label: "Shell",
    extensions: [".sh", ".bash", ".zsh"],
    command: "bash-language-server",
    installHint: "Install for Terax includes a private Node.js runtime.",
    docsUrl: "https://github.com/bash-lsp/bash-language-server",
  },
];

export type LspBinaryLink =
  | { kind: "path"; path: string }
  | { kind: "wsl"; distro: string; command: string };

export type LspBinaryProbe = {
  command: string;
  found: boolean;
  path: string | null;
  error: string | null;
  local: boolean;
  linked: boolean;
  wsl: boolean;
  source: "linked" | "system" | "terax" | null;
};

export async function probeLspBinary(
  command: string,
  options?: { localOnly?: boolean },
): Promise<LspBinaryProbe> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LspBinaryProbe>("lsp_probe_binary", {
    command,
    localOnly: options?.localOnly ?? false,
  });
}

export async function installLspBinary(
  command: string,
  onProgress: (message: string) => void,
): Promise<LspBinaryProbe> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const progress = new Channel<string>();
  progress.onmessage = onProgress;
  return invoke<LspBinaryProbe>("lsp_install", { command, onProgress: progress });
}

export async function linkLspBinary(
  command: string,
  link: LspBinaryLink,
): Promise<LspBinaryProbe> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LspBinaryProbe>("lsp_link_binary", { command, link });
}

export async function unlinkLspBinary(command: string): Promise<LspBinaryProbe> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LspBinaryProbe>("lsp_unlink_binary", { command });
}

export async function probeWslLspBinary(
  distro: string,
  command: string,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("lsp_probe_wsl_binary", { distro, command });
}
