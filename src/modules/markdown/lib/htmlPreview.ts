import type { WorkspaceEnv } from "@/modules/workspace";

const normalize = (path: string) => path.replace(/\\/g, "/");

export type HtmlPreviewBlock = "workspace-loading" | "wsl";

export const HTML_PREVIEW_BLOCK_HINT: Record<HtmlPreviewBlock, string> = {
  "workspace-loading": "Workspace is still loading",
  wsl: "Not available in WSL workspaces",
};

// The host asset protocol cannot serve paths inside a WSL distro. An unknown
// env means the tab's space is not hydrated yet (boot), so fail closed.
export function htmlPreviewBlock(
  env: WorkspaceEnv | undefined,
): HtmlPreviewBlock | null {
  if (!env) return "workspace-loading";
  return env.kind === "wsl" ? "wsl" : null;
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Runs `fn` once, `windowMs` after the last of a burst of triggers. */
export function createCoalescer(
  fn: () => void,
  windowMs: number,
  timers: Timers = defaultTimers,
) {
  let handle: unknown;
  let armed = false;
  const cancel = () => {
    if (armed) timers.clear(handle);
    armed = false;
  };
  return {
    trigger() {
      cancel();
      armed = true;
      handle = timers.set(() => {
        armed = false;
        fn();
      }, windowMs);
    },
    cancel,
  };
}

export function pathsInclude(paths: readonly string[], path: string): boolean {
  const target = normalize(path);
  return paths.some((p) => normalize(p) === target);
}

/**
 * `convertFileSrc` encodes the whole path as one segment, so a page's relative
 * URLs (`css/site.css`) would resolve against the asset root. Encoding each
 * segment keeps real slashes for the browser while the asset protocol, which
 * percent-decodes everything after the first `/`, still gets the same file.
 * `base` is `convertFileSrc("")`, the platform's asset origin plus `/`.
 */
export function htmlPreviewAssetUrl(base: string, path: string): string {
  const normalized = normalize(path);
  const absolute = normalized.startsWith("/");
  const segments = (absolute ? normalized.slice(1) : normalized).split("/");
  return `${base}${absolute ? "%2F" : ""}${segments.map(encodeURIComponent).join("/")}`;
}

// The asset protocol ignores the query string, so a revision suffix only
// defeats WebKit's cache for the document without changing what is served.
export function htmlPreviewSrc(assetUrl: string, revision: number): string {
  if (revision === 0) return assetUrl;
  const sep = assetUrl.includes("?") ? "&" : "?";
  return `${assetUrl}${sep}v=${revision}`;
}
