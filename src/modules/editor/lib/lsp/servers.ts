export type LspServerSpec = {
  command: string;
  args: string[];
  languageId: string;
};

const TS_FAMILY = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
]);

const depsServerBase = {
  command: "deps-lsp",
  args: ["--stdio"],
} as const;

const jsonServer: LspServerSpec = {
  command: "vscode-json-language-server",
  args: ["--stdio"],
  languageId: "json",
};

const jsoncServer: LspServerSpec = {
  command: "vscode-json-language-server",
  args: ["--stdio"],
  languageId: "jsonc",
};

/** Strict JSON — no comments in the language mode. */
const JSON_FILENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "composer.json",
  "manifest.json",
  "lerna.json",
  "vercel.json",
  "netlify.json",
  "firebase.json",
  "components.json",
  ".babelrc",
  ".prettierrc",
  ".stylelintrc",
]);

/** JSON with comments (jsonc). */
const JSONC_FILENAMES = new Set([
  "jsconfig.json",
  "deno.json",
  "deno.jsonc",
  ".eslintrc.json",
  ".prettierrc.json",
  "settings.json",
  "launch.json",
  "tasks.json",
  "extensions.json",
]);

const serversByExt: Record<string, LspServerSpec> = {
  rs: { command: "rust-analyzer", args: [], languageId: "rust" },
  py: { command: "pyright-langserver", args: ["--stdio"], languageId: "python" },
  go: { command: "gopls", args: [], languageId: "go" },
  json: jsonServer,
  jsonc: jsoncServer,
  sh: { command: "bash-language-server", args: ["start"], languageId: "shellscript" },
  bash: { command: "bash-language-server", args: ["start"], languageId: "shellscript" },
  zsh: { command: "bash-language-server", args: ["start"], languageId: "shellscript" },
  c: { command: "clangd", args: [], languageId: "c" },
  cpp: { command: "clangd", args: [], languageId: "cpp" },
  h: { command: "clangd", args: [], languageId: "c" },
  hpp: { command: "clangd", args: [], languageId: "cpp" },
  php: { command: "intelephense", args: ["--stdio"], languageId: "php" },
  phtml: { command: "intelephense", args: ["--stdio"], languageId: "php" },
};

const tsServer: LspServerSpec = {
  command: "typescript-language-server",
  args: ["--stdio"],
  languageId: "typescript",
};

function fileBaseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const parts = norm.split("/");
  return (parts[parts.length - 1] ?? norm).toLowerCase();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** Manifest files handled by deps-lsp (npm versions, Cargo crates, …). */
const DEPS_MANIFESTS: Record<string, string> = {
  "package.json": "json",
  "composer.json": "json",
  "cargo.toml": "toml",
  "pyproject.toml": "toml",
  "go.mod": "go.mod",
  gemfile: "ruby",
  "pubspec.yaml": "yaml",
};

/** JSON manifests where deps-lsp complements schema validation. */
const DEPS_WITH_JSON_SCHEMA = new Set(["package.json", "composer.json"]);

function resolveDepsManifest(path: string): LspServerSpec | null {
  const name = fileBaseName(path);
  const languageId = DEPS_MANIFESTS[name];
  if (!languageId) return null;
  return { ...depsServerBase, languageId };
}

function resolveJsonServer(path: string): LspServerSpec | null {
  const name = fileBaseName(path);
  const norm = normalizePath(path);

  if (JSONC_FILENAMES.has(name)) return { ...jsoncServer };
  if (JSON_FILENAMES.has(name)) return { ...jsonServer };

  if (name.startsWith("tsconfig") && name.endsWith(".json")) {
    return { ...jsoncServer };
  }

  if (norm.includes("/.vscode/") && name.endsWith(".json")) {
    return { ...jsoncServer };
  }

  if (name.endsWith(".jsonc")) return { ...jsoncServer };
  if (name.endsWith(".json")) return { ...jsonServer };

  return null;
}

export function resolveLspServerSpecs(path: string): LspServerSpec[] {
  const deps = resolveDepsManifest(path);
  if (deps) {
    const specs: LspServerSpec[] = [deps];
    const name = fileBaseName(path);
    if (DEPS_WITH_JSON_SCHEMA.has(name)) {
      const json = resolveJsonServer(path);
      if (json) specs.push(json);
    }
    return specs;
  }

  const single = resolvePrimaryLspServer(path);
  return single ? [single] : [];
}

export function resolveLspServer(path: string): LspServerSpec | null {
  return resolveLspServerSpecs(path)[0] ?? null;
}

function resolvePrimaryLspServer(path: string): LspServerSpec | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  if (ext && TS_FAMILY.has(ext)) {
    return {
      ...tsServer,
      languageId:
        ext === "tsx" || ext === "jsx"
          ? "typescriptreact"
          : ext === "ts" || ext === "mts" || ext === "cts"
            ? "typescript"
            : "javascript",
    };
  }

  const jsonSpec = resolveJsonServer(path);
  if (jsonSpec) return jsonSpec;

  if (!ext) return null;
  return serversByExt[ext] ?? null;
}

export function serverPoolKey(spec: LspServerSpec): string {
  return spec.command;
}
