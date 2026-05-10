import { Vim } from "@replit/codemirror-vim";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type VimHandlers = { save: () => void; close: () => void };

const handlers = new WeakMap<EditorView, VimHandlers>();

/** A CodeMirror extension that binds :w / :q handlers to this view. */
export function vimHandlersExtension(getHandlers: () => VimHandlers): Extension {
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

type CmAdapter = { cm6?: EditorView };
const getView = (cm: CmAdapter) => cm.cm6;

export function initVimGlobals(): void {
  if (initialized) return;
  initialized = true;

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
