// The heavy half of file icons: the whole Catppuccin SVG set (~300 kB) plus the
// name/extension/language maps. Never import this statically from startup code;
// `iconResolver.ts` loads it on demand and `src/app/eager-budget.test.ts` +
// `src/app/dist-budget.test.ts` fail if it lands in either window's startup graph.
import catppuccinIcons from "@iconify-json/catppuccin/icons.json";
import { EXT_TO_LANGUAGE_ID } from "./constants";
import * as fileIconsMod from "./fileIcons";
import * as folderIconsMod from "./folderIcons";

export type IconifySet = {
  icons: Record<string, { body: string }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
};

export type IconMaps = {
  /** exact (lowercased) file name -> icon name */
  fileNames: Record<string, string>;
  /** extension (no dot, may be compound like `d.ts`) -> icon name */
  fileExtensions: Record<string, string>;
  /** language id -> icon name */
  languageIds: Record<string, string>;
  /** extension -> language id, consulted when `fileExtensions` has no entry */
  extToLanguageId: Record<string, string>;
  /** lowercased folder name -> icon name */
  folderNames: Record<string, string>;
};

export type IconEngine = {
  fileIconUrl: (name: string) => string;
  folderIconUrl: (name: string, expanded: boolean) => string;
};

const DEFAULT_FILE = "file";
const DEFAULT_FOLDER = "folder";
const DEFAULT_FOLDER_OPEN = "folder-open";

// Catppuccin's manifest emits names like `folder_src`/`typescript-react`, but
// the iconify export normalizes everything to hyphenated slugs.
function toIconifySlug(name: string): string {
  return name.replace(/_/g, "-");
}

function extOf(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.indexOf(".");
  if (dot === -1 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

/** Pure factory so the resolution rules are testable against tiny fixtures. */
export function createIconEngine(set: IconifySet, maps: IconMaps): IconEngine {
  const width = set.width ?? 16;
  const height = set.height ?? 16;
  const dataUrlCache = new Map<string, string>();

  function body(iconName: string): string | null {
    const slug = toIconifySlug(iconName);
    const direct = set.icons[slug];
    if (direct) return direct.body;
    const alias = set.aliases?.[slug];
    if (alias) {
      const parent = set.icons[alias.parent];
      if (parent) return parent.body;
    }
    return null;
  }

  function dataUrl(iconName: string): string | null {
    const cached = dataUrlCache.get(iconName);
    if (cached !== undefined) return cached || null;
    const svgBody = body(iconName);
    if (!svgBody) {
      dataUrlCache.set(iconName, "");
      return null;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${svgBody}</svg>`;
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    dataUrlCache.set(iconName, url);
    return url;
  }

  return {
    fileIconUrl(name) {
      const lower = name.toLowerCase();

      const byName = maps.fileNames[lower];
      if (byName) {
        const url = dataUrl(byName);
        if (url) return url;
      }

      let ext = extOf(lower);
      while (ext) {
        const iconName = maps.fileExtensions[ext];
        if (iconName) {
          const url = dataUrl(iconName);
          if (url) return url;
        }
        const langId = maps.extToLanguageId[ext];
        if (langId) {
          const iconByLang = maps.languageIds[langId];
          if (iconByLang) {
            const url = dataUrl(iconByLang);
            if (url) return url;
          }
        }
        const nextDot = ext.indexOf(".");
        if (nextDot === -1) break;
        ext = ext.slice(nextDot + 1);
      }

      return dataUrl(DEFAULT_FILE) ?? "";
    },

    folderIconUrl(name, expanded) {
      const mapped = maps.folderNames[name.toLowerCase()];
      if (mapped) {
        const slug = toIconifySlug(mapped);
        const url = dataUrl(expanded ? `${slug}-open` : slug);
        if (url) return url;
      }
      return dataUrl(expanded ? DEFAULT_FOLDER_OPEN : DEFAULT_FOLDER) ?? "";
    },
  };
}

export const iconEngine: IconEngine = createIconEngine(
  catppuccinIcons as unknown as IconifySet,
  {
    fileNames: fileIconsMod.fileNames as Record<string, string>,
    fileExtensions: fileIconsMod.fileExtensions as Record<string, string>,
    languageIds: fileIconsMod.languageIds as Record<string, string>,
    extToLanguageId: EXT_TO_LANGUAGE_ID,
    folderNames: folderIconsMod.folderNames as Record<string, string>,
  },
);
