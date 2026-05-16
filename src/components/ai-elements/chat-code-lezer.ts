import type { Language, StreamParser } from "@codemirror/language";
import { StringStream } from "@codemirror/language";
import { classHighlighter, highlightCode } from "@lezer/highlight";

export type HighlightedNode =
  | { kind: "text"; value: string; cls: string }
  | { kind: "break" };

type ParserLoader = () => Promise<Language>;
type StreamLoader = () => Promise<StreamParser<unknown>>;

// Only langs that ship a real Lezer parser. Legacy stream-modes (bash,
// yaml, toml, c/cpp, java, csharp) fall back to plain <pre> — they don't
// produce a Tree, and dragging in a token-stream driver isn't worth the
// bytes for chat-side highlight.
const loaders: Record<string, ParserLoader> = {
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascriptLanguage),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.jsxLanguage),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.typescriptLanguage),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.tsxLanguage),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rustLanguage),
  go: () => import("@codemirror/lang-go").then((m) => m.goLanguage),
  python: () => import("@codemirror/lang-python").then((m) => m.pythonLanguage),
  json: () => import("@codemirror/lang-json").then((m) => m.jsonLanguage),
  html: () => import("@codemirror/lang-html").then((m) => m.htmlLanguage),
  css: () => import("@codemirror/lang-css").then((m) => m.cssLanguage),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdownLanguage),
  // `phpLanguage` parses files wrapped in `<?php …`. Chat snippets are bare
  // PHP, so use the `plain: true` variant's Language.
  php: () =>
    import("@codemirror/lang-php").then(
      (m) => m.php({ plain: true }).language,
    ),
};

// StreamParser fallback for langs without a Lezer parser. Token names emitted
// by legacy-modes (e.g. `keyword`, `string`, `comment`, `number`) line up with
// our `tok-*` CSS by prefix, so the same stylesheet works for both paths.
const streamLoaders: Record<string, StreamLoader> = {
  c: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.c as unknown as StreamParser<unknown>,
    ),
  cpp: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.cpp as unknown as StreamParser<unknown>,
    ),
  java: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.java as unknown as StreamParser<unknown>,
    ),
  csharp: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.csharp as unknown as StreamParser<unknown>,
    ),
  kotlin: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.kotlin as unknown as StreamParser<unknown>,
    ),
  scala: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.scala as unknown as StreamParser<unknown>,
    ),
  objectivec: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.objectiveC as unknown as StreamParser<unknown>,
    ),
  dart: () =>
    import("@codemirror/legacy-modes/mode/clike").then(
      (m) => m.dart as unknown as StreamParser<unknown>,
    ),
  yaml: () =>
    import("@codemirror/legacy-modes/mode/yaml").then(
      (m) => m.yaml as unknown as StreamParser<unknown>,
    ),
  toml: () =>
    import("@codemirror/legacy-modes/mode/toml").then(
      (m) => m.toml as unknown as StreamParser<unknown>,
    ),
  ruby: () =>
    import("@codemirror/legacy-modes/mode/ruby").then(
      (m) => m.ruby as unknown as StreamParser<unknown>,
    ),
  swift: () =>
    import("@codemirror/legacy-modes/mode/swift").then(
      (m) => m.swift as unknown as StreamParser<unknown>,
    ),
  lua: () =>
    import("@codemirror/legacy-modes/mode/lua").then(
      (m) => m.lua as unknown as StreamParser<unknown>,
    ),
  haskell: () =>
    import("@codemirror/legacy-modes/mode/haskell").then(
      (m) => m.haskell as unknown as StreamParser<unknown>,
    ),
  perl: () =>
    import("@codemirror/legacy-modes/mode/perl").then(
      (m) => m.perl as unknown as StreamParser<unknown>,
    ),
  r: () =>
    import("@codemirror/legacy-modes/mode/r").then(
      (m) => m.r as unknown as StreamParser<unknown>,
    ),
  dockerfile: () =>
    import("@codemirror/legacy-modes/mode/dockerfile").then(
      (m) => m.dockerFile as unknown as StreamParser<unknown>,
    ),
  nginx: () =>
    import("@codemirror/legacy-modes/mode/nginx").then(
      (m) => m.nginx as unknown as StreamParser<unknown>,
    ),
  diff: () =>
    import("@codemirror/legacy-modes/mode/diff").then(
      (m) => m.diff as unknown as StreamParser<unknown>,
    ),
};

const aliases: Record<string, string> = {
  javascript: "js",
  mjs: "js",
  cjs: "js",
  typescript: "ts",
  rs: "rust",
  py: "python",
  md: "markdown",
  htm: "html",
  // Stream-mode aliases.
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  h: "c",
  "c#": "csharp",
  cs: "csharp",
  kt: "kotlin",
  kts: "kotlin",
  "objective-c": "objectivec",
  objc: "objectivec",
  m: "objectivec",
  yml: "yaml",
  rb: "ruby",
  rake: "ruby",
  gemspec: "ruby",
  ru: "ruby",
  pl: "perl",
  hs: "haskell",
  docker: "dockerfile",
  conf: "nginx",
  patch: "diff",
};

type ResolvedKey =
  | { kind: "lezer"; key: keyof typeof loaders }
  | { kind: "stream"; key: keyof typeof streamLoaders };

function resolve(lang: string | null | undefined): ResolvedKey | null {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  const direct = lower in aliases ? aliases[lower]! : lower;
  if (direct in loaders) return { kind: "lezer", key: direct as keyof typeof loaders };
  if (direct in streamLoaders)
    return { kind: "stream", key: direct as keyof typeof streamLoaders };
  return null;
}

export function isHighlightable(lang: string | null | undefined): boolean {
  return resolve(lang) !== null;
}

const lezerCache = new Map<string, Language>();
const streamCache = new Map<string, StreamParser<unknown>>();

async function getLezer(key: keyof typeof loaders): Promise<Language> {
  const hit = lezerCache.get(key);
  if (hit) return hit;
  const lang = await loaders[key]!();
  lezerCache.set(key, lang);
  return lang;
}

async function getStream(
  key: keyof typeof streamLoaders,
): Promise<StreamParser<unknown>> {
  const hit = streamCache.get(key);
  if (hit) return hit;
  const parser = await streamLoaders[key]!();
  streamCache.set(key, parser);
  return parser;
}

function highlightStream(
  code: string,
  parser: StreamParser<unknown>,
): HighlightedNode[] {
  const state = parser.startState ? parser.startState(2) : ({} as unknown);
  const out: HighlightedNode[] = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) out.push({ kind: "break" });
    const line = lines[i] ?? "";
    if (parser.blankLine && line.length === 0) {
      parser.blankLine(state as never, 2);
      continue;
    }
    if (line.length === 0) continue;

    const stream = new StringStream(line, 2, 2, 0);
    while (!stream.eol()) {
      const start = stream.pos;
      let tag: string | null = null;
      try {
        tag = parser.token(stream, state as never) ?? null;
      } catch {
        tag = null;
      }
      // Guard: token() must advance; force one char if it didn't.
      if (stream.pos === start) {
        stream.pos = start + 1;
      }
      const text = line.slice(start, stream.pos);
      if (!text) continue;
      out.push({
        kind: "text",
        value: text,
        cls: tag ? mapStreamTag(tag) : "",
      });
    }
  }
  return out;
}

// Legacy-mode `token()` returns space-separated tag names like
// "keyword", "variable-2", "string-2", or "atom number". Map to our `tok-*`
// classes that the stylesheet already paints.
function mapStreamTag(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => {
      // strip CodeMirror 5's "-2" / "-3" qualifiers
      const base = t.replace(/-\d+$/, "");
      switch (base) {
        case "variable":
          return "tok-variableName";
        case "variable-2":
          return "tok-variableName";
        case "def":
          return "tok-definition tok-variableName";
        case "property":
          return "tok-propertyName";
        case "type":
          return "tok-typeName";
        case "builtin":
          return "tok-name";
        case "atom":
          return "tok-atom";
        case "tag":
          return "tok-tagName";
        case "attribute":
          return "tok-attributeName";
        case "meta":
          return "tok-meta";
        case "qualifier":
          return "tok-modifier";
        case "operator":
          return "tok-operator";
        case "bracket":
          return "tok-bracket";
        case "punctuation":
          return "tok-punctuation";
        case "header":
          return "tok-heading";
        case "link":
          return "tok-link";
        case "string":
          return "tok-string";
        case "string-2":
          return "tok-string";
        case "comment":
          return "tok-comment";
        case "number":
          return "tok-number";
        case "keyword":
          return "tok-keyword";
        default:
          return `tok-${base}`;
      }
    })
    .join(" ");
}

export async function highlight(
  code: string,
  rawLang: string,
): Promise<HighlightedNode[] | null> {
  const r = resolve(rawLang);
  if (!r) return null;

  if (r.kind === "lezer") {
    const language = await getLezer(r.key);
    const tree = language.parser.parse(code);
    const out: HighlightedNode[] = [];
    highlightCode(
      code,
      tree,
      classHighlighter,
      (text: string, cls: string) => {
        out.push({ kind: "text", value: text, cls });
      },
      () => {
        out.push({ kind: "break" });
      },
    );
    return out;
  }

  const parser = await getStream(r.key);
  return highlightStream(code, parser);
}
