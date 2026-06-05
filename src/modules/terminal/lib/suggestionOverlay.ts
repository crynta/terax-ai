import type { Terminal } from "@xterm/xterm";
import { suggestCommand } from "./commandHistory";
import type { PromptCallbacks } from "./osc-handlers";

/**
 * Inline, history-based command suggestion as a fish/zsh-autosuggestions style
 * ghost. The ghost is a DOM overlay positioned over the terminal grid; it is
 * never written into the xterm buffer or the PTY, so a geometry miss is at most
 * a visual nit and can never corrupt terminal state. Accepting the suggestion
 * is the only path that writes to the PTY.
 *
 * Enabled state is a module-level flag so a single boolean check short-circuits
 * the per-frame render hook when the feature is off (zero ongoing cost).
 */

let enabled = false;

export function setSuggestionsEnabled(value: boolean): void {
  enabled = value;
}

const controllers = new Map<number, Internal>();

export type SuggestionController = {
  callbacks: PromptCallbacks;
  dispose: () => void;
};

/** Send the active suggestion remainder to the PTY. Returns true if consumed. */
export function acceptSuggestion(leafId: number): boolean {
  return controllers.get(leafId)?.accept() ?? false;
}

export function hasActiveSuggestion(leafId: number): boolean {
  return controllers.get(leafId)?.hasSuggestion() ?? false;
}

type Internal = SuggestionController & {
  accept: () => boolean;
  hasSuggestion: () => boolean;
};

type CellDims = { width: number; height: number };

function cellDims(term: Terminal): CellDims | null {
  // Proposed-API surface (allowProposedApi is on). Guarded so a renderer
  // internals change degrades to "no ghost" rather than throwing.
  const dims = (
    term as unknown as {
      _core?: {
        _renderService?: { dimensions?: { css?: { cell?: CellDims } } };
      };
    }
  )._core?._renderService?.dimensions?.css?.cell;
  if (dims && dims.width > 0 && dims.height > 0) return dims;
  return null;
}

export function createSuggestionOverlay(
  leafId: number,
  term: Terminal,
  writeToPty: (data: string) => void,
): SuggestionController {
  const root = term.element;
  if (!root) {
    return { callbacks: {}, dispose: () => {} };
  }

  const ghost = document.createElement("div");
  ghost.setAttribute("data-terax-suggestion", "");
  ghost.style.cssText =
    "position:absolute;left:0;top:0;white-space:pre;pointer-events:none;z-index:5;opacity:0.4;visibility:hidden;";
  root.appendChild(ghost);

  let promptCol: number | null = null;
  let promptRow: number | null = null;
  let remainder = "";

  const hide = (): void => {
    if (remainder === "" && ghost.style.visibility === "hidden") return;
    remainder = "";
    ghost.style.visibility = "hidden";
    ghost.textContent = "";
  };

  const update = (): void => {
    if (!enabled || promptCol === null || promptRow === null) {
      hide();
      return;
    }
    const buf = term.buffer.active;
    const curRow = buf.baseY + buf.cursorY;
    // Bail on anything but a single, unwrapped input line with the cursor at
    // the end. Reading the whole input would otherwise need keystroke modeling.
    if (curRow !== promptRow || buf.cursorX < promptCol) {
      hide();
      return;
    }
    const line = buf.getLine(curRow)?.translateToString(true) ?? "";
    if (line.slice(buf.cursorX).trim() !== "") {
      hide();
      return;
    }
    const wanted = buf.cursorX - promptCol;
    let typed = line.slice(promptCol, buf.cursorX);
    if (typed.length < wanted) typed = typed.padEnd(wanted, " ");
    if (!typed.trim()) {
      hide();
      return;
    }
    const match = suggestCommand(typed);
    if (!match) {
      hide();
      return;
    }
    const dims = cellDims(term);
    if (!dims) {
      hide();
      return;
    }
    const maxCols = term.cols - buf.cursorX;
    const next = match.slice(typed.length).slice(0, Math.max(0, maxCols));
    if (!next) {
      hide();
      return;
    }
    remainder = next;
    ghost.textContent = next;
    ghost.style.left = `${buf.cursorX * dims.width}px`;
    ghost.style.top = `${buf.cursorY * dims.height}px`;
    ghost.style.height = `${dims.height}px`;
    ghost.style.lineHeight = `${dims.height}px`;
    ghost.style.fontFamily = String(term.options.fontFamily ?? "monospace");
    ghost.style.fontSize = `${term.options.fontSize ?? 14}px`;
    ghost.style.letterSpacing = `${term.options.letterSpacing ?? 0}px`;
    ghost.style.color = term.options.theme?.foreground ?? "#888";
    ghost.style.visibility = "visible";
  };

  const renderDisposable = term.onRender(update);
  const cursorDisposable = term.onCursorMove(update);

  const controller: Internal = {
    callbacks: {
      onCommand: () => {},
      onPromptStart: () => {
        promptCol = null;
        promptRow = null;
        hide();
      },
      onInputReady: () => {
        const buf = term.buffer.active;
        promptCol = buf.cursorX;
        promptRow = buf.baseY + buf.cursorY;
      },
      onCommandRun: () => {
        promptCol = null;
        promptRow = null;
        hide();
      },
    },
    hasSuggestion: () => remainder !== "",
    accept: () => {
      if (!remainder) return false;
      const text = remainder;
      hide();
      writeToPty(text);
      return true;
    },
    dispose: () => {
      controllers.delete(leafId);
      renderDisposable.dispose();
      cursorDisposable.dispose();
      ghost.remove();
    },
  };

  controllers.set(leafId, controller);
  return controller;
}
