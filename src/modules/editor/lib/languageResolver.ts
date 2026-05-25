import type { Extension } from "@codemirror/state";

type LoaderResult = Extension | { token: unknown };
type LanguageLoader = () => Promise<LoaderResult>;

const rubyLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby);

const jsonLoader: LanguageLoader = () =>
  import("@codemirror/lang-json").then((m) => m.json());

const sqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL);
const pgsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.pgSQL);
const mysqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mySQL);
const sqliteLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.sqlite);
const mariadbLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.mariaDB);
const mssqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.msSQL);
const plsqlLoader: LanguageLoader = () =>
  import("@codemirror/legacy-modes/mode/sql").then((m) => m.plSQL);

/**
 * Extension → loader. Each loader is a dynamic import so language packs
 * only enter the bundle when a matching file is opened.
 *
 * Loaders may return either a ready Extension (lang-* packages) or a raw
 * StreamParser (legacy-modes). `resolveLanguage` wraps the latter in
 * StreamLanguage before returning.
 */
const loaders: Record<string, LanguageLoader> = {
  // JavaScript / TypeScript family
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true }),
    ),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  ts: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true }),
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),

  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  json: jsonLoader,
  jsonc: jsonLoader,
  json5: jsonLoader,

  sql: sqlLoader,
  psql: pgsqlLoader,
  pgsql: pgsqlLoader,
  mysql: mysqlLoader,
  sqlite: sqliteLoader,
  mariadb: mariadbLoader,
  mssql: mssqlLoader,
  plsql: plsqlLoader,

  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),

  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),

  php: () => import("@codemirror/lang-php").then((m) => m.php({ plain: true })),
  rb: rubyLoader,
  rake: rubyLoader,
  gemspec: rubyLoader,
  ru: rubyLoader,

  // C / C++ family
  c: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  h: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.c),
  cpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  cc: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  cxx: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  hpp: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),
  hxx: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.cpp),

  // Java
  java: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.java),

  // C#
  cs: () => import("@codemirror/legacy-modes/mode/clike").then((m) => m.csharp),

  // Legacy-modes: loaders return the raw StreamParser; wrapped below.
  sh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  bash: () =>
    import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  zsh: () => import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml),
  yaml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  yml: () => import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml),
  dockerfile: () =>
    import("@codemirror/legacy-modes/mode/dockerfile").then(
      (m) => m.dockerFile,
    ),

  // LaTeX / TeX
  tex: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  latex: () =>
    import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  sty: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
  cls: () => import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex),
};

const filenameOverrides: Record<string, LanguageLoader> = {
  dockerfile: loaders.dockerfile!,
  "dockerfile.dev": loaders.dockerfile!,
  gemfile: rubyLoader,
  rakefile: rubyLoader,
  podfile: rubyLoader,
  fastfile: rubyLoader,
  guardfile: rubyLoader,
  brewfile: rubyLoader,
};

function extOf(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

function isStreamParser(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { token?: unknown }).token === "function"
  );
}

const cache = new Map<string, Extension | null>();

function cacheKey(filename: string): string | null {
  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (filenameOverrides[base]) return `name:${base}`;
  const ext = extOf(base);
  return ext ? `ext:${ext}` : null;
}

export function resolveLanguageSync(filename: string): Extension | null {
  const key = cacheKey(filename);
  return key ? (cache.get(key) ?? null) : null;
}

export async function resolveLanguage(
  filename: string,
): Promise<Extension | null> {
  const key = cacheKey(filename);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  const loader = filenameOverrides[base] ?? loaders[extOf(base) ?? ""];
  if (!loader) {
    cache.set(key, null);
    return null;
  }

  const result = await loader();
  let ext: Extension;
  if (isStreamParser(result)) {
    const { StreamLanguage } = await import("@codemirror/language");
    ext = StreamLanguage.define(
      result as Parameters<typeof StreamLanguage.define>[0],
    );
  } else {
    ext = result as Extension;
  }
  cache.set(key, ext);
  return ext;
}

export function preloadLanguages(filenames: string[]): void {
  for (const f of filenames) {
    void resolveLanguage(f).catch(() => {});
  }
}
