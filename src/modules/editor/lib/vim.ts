import type { VimKeymap } from "@/modules/settings/store";
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";

export type VimHandlers = { save: () => void; close: () => void };

const handlers = new WeakMap<EditorView, VimHandlers>();

/** A CodeMirror extension that binds :w / :q handlers to this view. */
export function vimHandlersExtension(
  getHandlers: () => VimHandlers,
): Extension {
  return ViewPlugin.define((view) => {
    handlers.set(view, getHandlers());
    return {
      update() {
        // Keep handlers fresh in case the closure captured stale refs.
        handlers.set(view, getHandlers());
      },
      destroy() {
        handlers.delete(view);
      },
    };
  });
}

let initialized = false;

export function initVimGlobals(): void {
  if (initialized) return;
  initialized = true;

  type CmAdapter = { cm6?: EditorView };
  const getView = (cm: CmAdapter) => cm.cm6;

  Vim.defineEx("write", "w", (cm: CmAdapter) => {
    const view = getView(cm);
    if (view) handlers.get(view)?.save();
  });

  Vim.defineEx("quit", "q", (cm: CmAdapter) => {
    const view = getView(cm);
    if (view) handlers.get(view)?.close();
  });

  Vim.defineEx("wq", "wq", (cm: CmAdapter) => {
    const view = getView(cm);
    if (!view) return;
    const h = handlers.get(view);
    h?.save();
    h?.close();
  });

  Vim.defineEx("xit", "x", (cm: CmAdapter) => {
    const view = getView(cm);
    if (!view) return;
    const h = handlers.get(view);
    h?.save();
    h?.close();
  });

  // Arrow keys are forwarded by the plugin to the editor scope handlers,
  // which breaks operator-pending (d<Up>) and counts (15<Up>). Remap to
  // hjkl so they stay inside the vim state machine.
  Vim.map("<Up>", "k", "normal");
  Vim.map("<Down>", "j", "normal");
  Vim.map("<Left>", "h", "normal");
  Vim.map("<Right>", "l", "normal");
  Vim.map("<Up>", "k", "visual");
  Vim.map("<Down>", "j", "visual");
  Vim.map("<Left>", "h", "visual");
  Vim.map("<Right>", "l", "visual");
}

// Vim.map is global to the vim adapter, so user mappings are applied once
// per change, not per editor. Previous ones are unmapped first — otherwise
// an edited or deleted row would leave its old mapping behind.
let appliedKeymaps: VimKeymap[] = [];

export function applyVimKeymaps(maps: VimKeymap[]): void {
  for (const m of appliedKeymaps) {
    try {
      Vim.unmap(m.lhs, m.mode);
    } catch {
      // already unmapped
    }
  }
  appliedKeymaps = [];
  for (const m of maps) {
    const lhs = m.lhs.trim();
    const rhs = m.rhs.trim();
    if (!lhs || !rhs) continue;
    Vim.map(lhs, rhs, m.mode);
    appliedKeymaps.push({ lhs, rhs, mode: m.mode });
  }
}
