import { convertFileSrc } from "@tauri-apps/api/core";
import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

/**
 * Hover thumbnails for clipboard images pasted into the terminal (builds on the
 * image-paste feature from PR #506).
 *
 * #506 pastes the temp PNG path into the shell; a CLI agent like Claude Code
 * reads it and renders an `[Image #N]` token. That token is owned by the agent,
 * not Terax, so correlating it back to the pasted file is inherently best-effort.
 * We use a hybrid scheme:
 *
 *  - **Path token** (`terax-clipboard-<ms>-<pid>.png`, visible in plain shells):
 *    matched 1:1 against the registry — always correct.
 *  - **`[Image #N]`** (Claude's rendering): mapped to the N-th image pasted in
 *    the *current* prompt. The per-prompt counter resets when the user submits
 *    (a bare Enter to the PTY), mirroring Claude's per-prompt numbering. Stale
 *    `[Image #N]` tokens left in scrollback from earlier prompts may resolve to
 *    the latest prompt's image — the documented limitation of not owning #N.
 */

const THUMB_MAX_DIM = 160;
const MAX_ENTRIES_PER_LEAF = 50;

// `terax-clipboard-<unix-ms>-<pid>.png` (see clipboard.rs FILE naming).
const PATH_TOKEN = String.raw`terax-clipboard-\d+-\d+\.png`;
const IMAGE_TOKEN = String.raw`\[Image #\d+\]`;
// Combined matcher for the link provider (global, multi-match per line).
const TOKEN_RE = new RegExp(`${IMAGE_TOKEN}|${PATH_TOKEN}`, "g");

type ImageEntry = {
  /** 1-based index within the prompt at paste time (maps to `[Image #N]`). */
  promptSeq: number;
  /** Absolute temp PNG path that was pasted. */
  path: string;
  /** Basename, for matching a visible path token. */
  file: string;
  /** Compressed JPEG data URL; filled asynchronously after paste. */
  thumbUrl?: string;
};

type LeafImages = {
  entries: ImageEntry[];
  /** Images pasted since the last submit; reset by resetImagePromptCounter. */
  promptCount: number;
};

const byLeaf = new Map<number, LeafImages>();

function leafState(leafId: number): LeafImages {
  let s = byLeaf.get(leafId);
  if (!s) {
    s = { entries: [], promptCount: 0 };
    byLeaf.set(leafId, s);
  }
  return s;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Record an image just pasted into `leafId`'s terminal and kick off thumbnail
 * generation. Called from the paste handler after the path is written to the PTY.
 */
export function registerPastedImage(leafId: number, path: string): void {
  const s = leafState(leafId);
  s.promptCount += 1;
  const entry: ImageEntry = {
    promptSeq: s.promptCount,
    path,
    file: basename(path),
  };
  s.entries.push(entry);
  if (s.entries.length > MAX_ENTRIES_PER_LEAF) s.entries.shift();
  void generateThumb(entry);
}

/** Reset the per-prompt counter — call when the user submits (bare Enter). */
export function resetImagePromptCounter(leafId: number): void {
  const s = byLeaf.get(leafId);
  if (s) s.promptCount = 0;
}

/** Drop a leaf's registry on respawn/dispose. */
export function clearLeafImages(leafId: number): void {
  byLeaf.delete(leafId);
}

/**
 * Resolve a matched terminal token to its registry entry. Path tokens match
 * 1:1 by filename; `[Image #N]` maps to the N-th image of the current prompt.
 * Exported for unit tests; `resolveThumb` is the runtime entry point.
 */
export function resolveImageEntry(
  leafId: number,
  text: string,
): ImageEntry | undefined {
  const s = byLeaf.get(leafId);
  if (!s) return undefined;

  const pathMatch = text.match(new RegExp(PATH_TOKEN));
  if (pathMatch) {
    const file = pathMatch[0];
    for (let i = s.entries.length - 1; i >= 0; i--) {
      if (s.entries[i].file === file) return s.entries[i];
    }
    return undefined;
  }

  const imgMatch = text.match(/\[Image #(\d+)\]/);
  if (imgMatch) {
    const n = Number(imgMatch[1]);
    for (let i = s.entries.length - 1; i >= 0; i--) {
      if (s.entries[i].promptSeq === n) return s.entries[i];
    }
  }
  return undefined;
}

function resolveThumb(leafId: number, text: string): string | undefined {
  return resolveImageEntry(leafId, text)?.thumbUrl;
}

async function generateThumb(entry: ImageEntry): Promise<void> {
  try {
    const src = convertFileSrc(entry.path);
    entry.thumbUrl = await makeThumbnail(src);
  } catch (e) {
    console.warn("[terax] image thumbnail failed:", e);
  }
}

/** Downscale an image URL to a small, compressed preview for hover. */
function makeThumbnail(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (!width || !height) {
        reject(new Error("empty image"));
        return;
      }
      const scale = Math.min(1, THUMB_MAX_DIM / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => reject(new Error("thumbnail decode failed"));
    img.src = src;
  });
}

// ---- Hover overlay -------------------------------------------------------

const TOOLTIP_OFFSET = 14;

function createTooltip(): HTMLImageElement {
  const el = document.createElement("img");
  el.setAttribute("data-terax-image-thumb", "");
  el.style.cssText = [
    "position:fixed",
    "z-index:9999",
    "max-width:240px",
    "max-height:240px",
    "border-radius:6px",
    "box-shadow:0 4px 16px rgba(0,0,0,.4)",
    "border:1px solid rgba(255,255,255,.12)",
    "pointer-events:none",
    "display:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

function showTooltip(el: HTMLImageElement, thumb: string, ev: MouseEvent): void {
  el.src = thumb;
  el.style.display = "block";
  // Position bottom-right of the cursor, clamped to the viewport.
  const x = Math.min(ev.clientX + TOOLTIP_OFFSET, window.innerWidth - 260);
  const y = Math.min(ev.clientY + TOOLTIP_OFFSET, window.innerHeight - 260);
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip(el: HTMLImageElement): void {
  el.style.display = "none";
  el.removeAttribute("src");
}

/**
 * Register an xterm link provider that turns `[Image #N]` / pasted-path tokens
 * into hover targets showing the compressed thumbnail. Registered once per slot
 * (the term outlives leaf rebinds); `getLeafId` resolves the slot's current leaf
 * at hover time. Returns a disposer that also removes the overlay element.
 */
export function registerImageThumbnailLinks(
  term: Terminal,
  getLeafId: () => number | null,
): () => void {
  const tooltip = createTooltip();

  const provider: ILinkProvider = {
    provideLinks(y, callback) {
      const leafId = getLeafId();
      if (leafId === null) {
        callback(undefined);
        return;
      }
      const line = term.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const matchText = m[0];
        const startX = m.index + 1; // xterm columns are 1-based
        const endX = m.index + matchText.length; // inclusive last cell
        links.push({
          text: matchText,
          range: { start: { x: startX, y }, end: { x: endX, y } },
          activate: () => {},
          hover: (event) => {
            const thumb = resolveThumb(leafId, matchText);
            if (thumb) showTooltip(tooltip, thumb, event as MouseEvent);
          },
          leave: () => hideTooltip(tooltip),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };

  let disposable: IDisposable | null = null;
  try {
    disposable = term.registerLinkProvider(provider);
  } catch (e) {
    console.warn("[terax] image link provider unavailable:", e);
  }
  return () => {
    try {
      disposable?.dispose();
    } catch {}
    tooltip.remove();
  };
}
