import type { LspCustomServer } from "@/modules/settings/store";

export type LspPreset = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** languageResolver id -> LSP languageId */
  languages: Record<string, string>;
  rootMarkers: string[];
  initializationOptions?: unknown;
  env?: Record<string, string>;
  maxMemoryMb?: number;
  /** Absent for user-defined servers. */
  install?: { command: string; docsUrl: string };
};

export const LSP_PRESETS: LspPreset[] = [
  {
    id: "typescript",
    name: "TypeScript",
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
    },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    initializationOptions: { maxTsServerMemory: 3072 },
    install: {
      command: "npm install -g typescript-language-server typescript",
      docsUrl:
        "https://github.com/typescript-language-server/typescript-language-server",
    },
  },
  {
    id: "rust-analyzer",
    name: "Rust",
    command: "rust-analyzer",
    args: [],
    languages: { rs: "rust" },
    rootMarkers: ["Cargo.toml"],
    // Measured: default profile settles at ~3 GB resident, this one at ~1 GB,
    // trading analysis inside proc macros and cargo-check diagnostics.
    initializationOptions: {
      cachePriming: { enable: false },
      lru: { capacity: 32 },
      checkOnSave: false,
      procMacro: { enable: false },
      cargo: { buildScripts: { enable: false } },
      diagnostics: {
        disabled: ["unresolved-proc-macro", "unresolved-macro-call"],
      },
    },
    env: { CARGO_BUILD_JOBS: "2" },
    maxMemoryMb: 3072,
    install: {
      command: "rustup component add rust-analyzer",
      docsUrl: "https://rust-analyzer.github.io/book/installation.html",
    },
  },
  {
    id: "pyright",
    name: "Python",
    command: "pyright-langserver",
    args: ["--stdio"],
    languages: { py: "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
    install: {
      command: "npm install -g pyright",
      docsUrl: "https://microsoft.github.io/pyright/#/installation",
    },
  },
  {
    id: "gopls",
    name: "Go",
    command: "gopls",
    args: [],
    languages: { go: "go" },
    rootMarkers: ["go.mod", "go.work"],
    install: {
      command: "go install golang.org/x/tools/gopls@latest",
      docsUrl: "https://pkg.go.dev/golang.org/x/tools/gopls#section-readme",
    },
  },
];

function fromCustom(server: LspCustomServer): LspPreset {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    args: server.args,
    languages: server.languages,
    rootMarkers: server.rootMarkers,
  };
}

export function allServers(custom: LspCustomServer[]): LspPreset[] {
  return [...LSP_PRESETS, ...custom.map(fromCustom)];
}

export function serverForLanguage(
  langId: string | null,
  custom: LspCustomServer[],
): LspPreset | null {
  if (!langId) return null;
  return allServers(custom).find((p) => langId in p.languages) ?? null;
}

export function serverById(
  id: string,
  custom: LspCustomServer[],
): LspPreset | null {
  return allServers(custom).find((p) => p.id === id) ?? null;
}
