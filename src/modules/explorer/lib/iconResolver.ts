import catppuccinIcons from "@iconify-json/catppuccin/icons.json";
import materialIcons from "@iconify-json/material-icon-theme/icons.json";
import type { IconThemeId } from "@/modules/settings/store";
import { EXT_TO_LANGUAGE_ID } from "./constants";
import * as fileIconsMod from "./fileIcons";
import * as folderIconsMod from "./folderIcons";

const catFileNames = fileIconsMod.fileNames as Record<string, string>;
const catFileExtensions = fileIconsMod.fileExtensions as Record<string, string>;
const catLanguageIds = fileIconsMod.languageIds as Record<string, string>;
const catFolderNames = folderIconsMod.folderNames as Record<string, string>;

type IconifySet = {
  icons: Record<
    string,
    { body: string; width?: number; height?: number; left?: number; top?: number }
  >;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

const SETS: Record<IconThemeId, IconifySet> = {
  catppuccin: catppuccinIcons as unknown as IconifySet,
  material: materialIcons as unknown as IconifySet,
};

// Per-theme generic fallback slugs. Catppuccin uses `file` / `folder` /
// `folder-open`; Material publishes `document` / `folder-base` /
// `folder-base-open` (matches Material Icon Theme upstream).
const DEFAULT_FILE: Record<IconThemeId, string> = {
  catppuccin: "file",
  material: "document",
};
const DEFAULT_FOLDER: Record<IconThemeId, string> = {
  catppuccin: "folder",
  material: "folder-base",
};
const DEFAULT_FOLDER_OPEN: Record<IconThemeId, string> = {
  catppuccin: "folder-open",
  material: "folder-base-open",
};

// fileIcons.ts targets are written against the Catppuccin slug vocabulary.
// Material uses different names for some common icons; remap on lookup so a
// Catppuccin-named target still resolves to the right Material slug.
const MATERIAL_SLUG_OVERRIDES: Record<string, string> = {
  "typescript-react": "react-ts",
  "javascript-react": "react",
  "typescript-config": "tsconfig",
  "typescript-test": "test-ts",
  "javascript-test": "test-js",
  "javascript-map": "javascript",
  "javascript-config": "jsconfig",
  "json-schema": "json",
  "css-map": "css",
  "c-header": "cppheader",
  "cpp-header": "cppheader",
  "ms-excel": "excel",
  "ms-word": "word",
  "ms-powerpoint": "powerpoint",
  "java-class": "java",
  "java-jar": "jar",
  "go-template": "go",
  "ruby-gem": "gemfile",
  "ruby-gem-lock": "gemfile",
  "npm-lock": "npm",
  "yarn-lock": "yarn",
  "pnpm-lock": "pnpm",
  "bun-lock": "bun",
  "cargo-lock": "cargo",
  "python-config": "python",
  "python-compiled": "python",
  "nix-lock": "nix",
  "dart-generated": "dart",
  "godot-assets": "godot",
  "code-of-conduct": "conduct",
  "code-climate": "codeclimate",
  "circle-ci": "circleci",
  "docker-compose": "docker",
  "docker-ignore": "docker",
  "git-cliff": "git",
  "markdown-mdx": "mdx",
  "package-json": "nodejs",
  "panda-css": "panda",
  "pre-commit": "settings",
  "prettier-ignore": "prettier",
  "eslint-ignore": "eslint",
  "stylelint-ignore": "stylelint",
  "stylua-ignore": "stylua",
  "semgrep-ignore": "semgrep",
  "cursor-ignore": "cursor",
  "nuxt-ignore": "nuxt",
  "tauri-ignore": "tauri",
  "vscode-ignore": "vscode",
  "vercel-ignore": "vercel",
  "vs-codium": "vscode",
  "sonar-cloud": "sonarcloud",
  "rust-config": "rust",
  "web-assembly": "webassembly",
  "ansible-lint": "ansible",
  "lint-staged": "lintstaged",
  "adobe-ae": "after-effects",
  "adobe-ai": "illustrator",
  "adobe-id": "indesign",
  "adobe-ps": "photoshop",
  "adobe-xd": "adobe",
  "super-collider": "supercollider",
  "storybook-svelte": "storybook",
  "storybook-vue": "storybook",
  "vue-config": "vue",
  "svelte-config": "svelte",
  "pesde-lock": "pesde",
  "pixi-lock": "pixi",
  "poetry-lock": "poetry",
};

function resolveSlug(theme: IconThemeId, name: string): string {
  if (theme === "material") {
    return MATERIAL_SLUG_OVERRIDES[name] ?? name.replace(/_/g, "-");
  }
  return name.replace(/_/g, "-");
}

const dataUrlCacheByTheme = new Map<IconThemeId, Map<string, string>>();

function getCache(theme: IconThemeId): Map<string, string> {
  let m = dataUrlCacheByTheme.get(theme);
  if (!m) {
    m = new Map<string, string>();
    dataUrlCacheByTheme.set(theme, m);
  }
  return m;
}

type ResolvedIcon = {
  body: string;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};

function bodyFromSet(set: IconifySet, slug: string): ResolvedIcon | null {
  const direct = set.icons[slug];
  if (direct) {
    return {
      body: direct.body,
      width: direct.width,
      height: direct.height,
      left: direct.left,
      top: direct.top,
    };
  }
  const alias = set.aliases?.[slug];
  if (alias) {
    const parent = set.icons[alias.parent];
    if (parent) {
      return {
        body: parent.body,
        width: parent.width,
        height: parent.height,
        left: parent.left,
        top: parent.top,
      };
    }
  }
  return null;
}

function buildDataUrl(theme: IconThemeId, name: string): string | null {
  const cache = getCache(theme);
  const cached = cache.get(name);
  if (cached !== undefined) return cached || null;

  const set = SETS[theme];
  let resolved = bodyFromSet(set, resolveSlug(theme, name));

  // Fall back to per-theme default slug if specific icon is missing.
  if (!resolved) {
    const isFolderOpen = name === "folder-open" || name.endsWith("-open");
    const isFolder = name === "folder" || name.startsWith("folder-") || isFolderOpen;
    const fallback = isFolderOpen
      ? DEFAULT_FOLDER_OPEN[theme]
      : isFolder
        ? DEFAULT_FOLDER[theme]
        : DEFAULT_FILE[theme];
    resolved = bodyFromSet(set, fallback);
  }

  if (!resolved) {
    cache.set(name, "");
    return null;
  }

  // Iconify allows per-icon dimensions and viewBox origin (left/top); fall
  // back to set-level (defaults: 0 0 16 16). Material mixes 16/24/32-px and
  // Material-Design coordinate systems (e.g. JSON path uses left=0, top=-960,
  // 960x960) so honouring left/top is required for non-cropped rendering.
  const w = resolved.width ?? set.width ?? 16;
  const h = resolved.height ?? set.height ?? 16;
  const x = resolved.left ?? set.left ?? 0;
  const y = resolved.top ?? set.top ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">${resolved.body}</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(name, url);
  return url;
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.indexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

export function fileIconUrl(name: string, theme: IconThemeId = "catppuccin"): string {
  const lower = name.toLowerCase();

  const byName = catFileNames[lower];
  if (byName) {
    const url = buildDataUrl(theme, byName);
    if (url) return url;
  }

  let ext = extOf(lower);
  while (ext) {
    const iconName = catFileExtensions[ext];
    if (iconName) {
      const url = buildDataUrl(theme, iconName);
      if (url) return url;
    }
    const langId = EXT_TO_LANGUAGE_ID[ext];
    if (langId) {
      const iconByLang = catLanguageIds[langId];
      if (iconByLang) {
        const url = buildDataUrl(theme, iconByLang);
        if (url) return url;
      }
    }
    const nextDot = ext.indexOf(".");
    if (nextDot === -1) break;
    ext = ext.slice(nextDot + 1);
  }

  return buildDataUrl(theme, DEFAULT_FILE[theme]) ?? "";
}

export function folderIconUrl(
  name: string,
  expanded: boolean,
  theme: IconThemeId = "catppuccin",
): string {
  const lower = name.toLowerCase();

  const mapped = catFolderNames[lower];
  if (mapped) {
    const slug = mapped.replace(/_/g, "-");
    const target = expanded ? `${slug}-open` : slug;
    const url = buildDataUrl(theme, target);
    if (url) return url;
  }

  return buildDataUrl(
    theme,
    expanded ? DEFAULT_FOLDER_OPEN[theme] : DEFAULT_FOLDER[theme],
  ) ?? "";
}
