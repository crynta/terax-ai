// Command completion menu for the CLASSIC terminal (vim/Termius-style):
// OSC 133 B tells us where the editable command line starts, the line text is
// read back from the xterm buffer (echo is synchronous), and a dropdown of
// candidates (shell history first, AI when history is silent) is anchored to
// the cursor cell via an xterm decoration. ↓/↑ select, → / Tab accept
// (types the remainder into the PTY), Esc dismisses.

import { usePreferencesStore } from "@/modules/settings/preferences";
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import {
  type AiShellSuggest,
  createAiShellSuggest,
  fixFailedCommand,
} from "../block/lib/aiSuggest";
import { historyCommands, historyList } from "../block/lib/history";

const prefs = () => usePreferencesStore.getState();

type Candidate = { text: string; ai: boolean; fix?: boolean };

// Approximate terminal cell width: CJK and emoji occupy two cells. Close
// enough for menu anchoring; exact width lives in xterm's internals.
function isWideCodepoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function cellWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += isWideCodepoint(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
}

export type ClassicSuggestEngine = {
  /** OSC 133 B — the shell is reading input at the current cursor cell. */
  onInputStart: () => void;
  /** Mirrors the prompt tracker's running flag (C=true, A/D=false). */
  onCommandState: (
    running: boolean,
    command?: string,
    exitCode?: number | null,
  ) => void;
  /** Keydown hook (capture); true = consumed by the menu. */
  onKey: (ev: KeyboardEvent) => boolean;
  dispose: () => void;
};

export function createClassicSuggest(opts: {
  term: Terminal;
  write: (data: string) => void;
  getCwd: () => string | null;
  /** False for private tabs: local history menu only — no line, history,
   *  buffer or NL text may ever leave the machine. */
  allowAi?: boolean;
}): ClassicSuggestEngine {
  const { term } = opts;
  const allowAi = opts.allowAi ?? true;

  let recent: string[] = [];
  const refreshRecent = () => {
    void historyCommands("", 30).then((cmds) => {
      recent = cmds;
    });
  };
  refreshRecent();

  // Not even constructed for private tabs — its key watcher lazy-loads the
  // AI stack, and no code path here may call the model.
  const ai: AiShellSuggest | null = allowAi
    ? createAiShellSuggest({
        getCwd: opts.getCwd,
        getRecent: () => recent,
      })
    : null;

  let atInput = false;
  let inputLine = -1; // absolute buffer row of the input start
  let inputCol = 0;

  let lastLine = "";
  let dismissedLine: string | null = null;
  let candidates: Candidate[] = [];
  let selected = 0;

  // Last failed command, captured at OSC 133 D — offered as an "AI FIX"
  // candidate at the next empty prompt.
  let lastCommand = "";
  let pendingFix: {
    command: string;
    output: string;
    exitCode: number | null;
  } | null = null;

  // Bumped on every new prompt: stale async fix offers check it.
  let inputEpoch = 0;

  let deco: IDecoration | null = null;
  let decoMarker: IMarker | null = null;
  let menuEl: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const hideMenu = () => {
    candidates = [];
    selected = 0;
    menuEl = null;
    deco?.dispose();
    deco = null;
    decoMarker?.dispose();
    decoMarker = null;
  };

  /** Editable text between the input start and the cursor; null when the
   *  cursor left the input row (wrap, output, alt screen) or has content
   *  right after it (mid-line editing). */
  const currentLine = (): string | null => {
    if (!atInput || disposed) return null;
    const buf = term.buffer.active;
    if (buf.type === "alternate") return null;
    const row = buf.baseY + buf.cursorY;
    if (row !== inputLine) return null;
    const line = buf.getLine(row);
    if (!line) return null;
    // Tolerate content far to the right (zsh RPROMPT, plugin ghosts):
    // only the next two cells must be blank.
    const next = line.translateToString(false, buf.cursorX, buf.cursorX + 2);
    if (next.trim().length > 0) return null;
    return line.translateToString(true, inputCol, buf.cursorX);
  };

  const renderRows = () => {
    if (!menuEl) return;
    menuEl.replaceChildren();
    candidates.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "terax-term-menu-row";
      if (i === selected) row.dataset.selected = "true";
      if (c.text.startsWith(lastLine)) {
        const typed = document.createElement("span");
        typed.className = "terax-term-menu-typed";
        typed.textContent = lastLine;
        const rest = document.createElement("span");
        rest.textContent = c.text.slice(lastLine.length);
        row.append(typed, rest);
      } else {
        // Correction — the whole line is a replacement for what's typed.
        const fix = document.createElement("span");
        fix.textContent = c.text;
        row.append(fix);
      }
      if (c.ai) {
        const badge = document.createElement("span");
        badge.className = "terax-term-menu-badge";
        const isNl = lastLine.trimStart().startsWith("#");
        badge.textContent =
          c.fix || (!isNl && !c.text.startsWith(lastLine)) ? "AI FIX" : "AI";
        row.append(badge);
      }
      // Mouse: click accepts; move highlights.
      row.addEventListener("pointerenter", () => {
        selected = i;
        renderRows();
      });
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        accept(i);
      });
      menuEl?.append(row);
    });
  };

  const ensureMenu = () => {
    const buf = term.buffer.active;
    if (!deco) {
      decoMarker = term.registerMarker(0);
      if (!decoMarker) return;
      const d = term.registerDecoration({
        marker: decoMarker,
        x: Math.max(
          0,
          buf.cursorX - Math.min(cellWidth(lastLine), buf.cursorX),
        ),
        width: 1,
      });
      if (!d) return;
      deco = d;
      // Open upward when the cursor sits in the lower half of the viewport.
      const flip = buf.cursorY > term.rows / 2;
      d.onRender((el) => {
        el.classList.add("terax-term-menu-anchor");
        if (!menuEl) {
          menuEl = document.createElement("div");
          menuEl.className = "terax-term-menu";
          menuEl.dataset.flip = flip ? "true" : "false";
          el.append(menuEl);
          renderRows();
        }
      });
    } else {
      renderRows();
    }
  };

  const showCandidates = (items: Candidate[]) => {
    const hadMenu = !!menuEl;
    candidates = items.slice(0, prefs().terminalSuggestMaxItems);
    selected = 0;
    if (candidates.length === 0) {
      hideMenu();
      return;
    }
    if (hadMenu) renderRows();
    else {
      // Re-anchor at the current input start.
      deco?.dispose();
      deco = null;
      decoMarker?.dispose();
      decoMarker = null;
      menuEl = null;
      ensureMenu();
    }
  };

  const accept = (index: number) => {
    const c = candidates[index];
    if (!c) return;
    const line = currentLine() ?? lastLine;
    dismissedLine = c.text;
    hideMenu();
    if (c.text === line) return;
    if (c.text.startsWith(line)) {
      opts.write(c.text.slice(line.length));
      return;
    }
    // Correction: backspace to the common prefix, then type the difference.
    // Code points, not UTF-16 units: readline erases one CHARACTER per DEL,
    // and a unit count overshoots on emoji, eating a char before the fix.
    const lineCp = Array.from(line);
    const textCp = Array.from(c.text);
    let common = 0;
    while (
      common < lineCp.length &&
      common < textCp.length &&
      lineCp[common] === textCp[common]
    ) {
      common++;
    }
    opts.write(
      "\x7f".repeat(lineCp.length - common) + textCp.slice(common).join(""),
    );
  };

  const recompute = () => {
    if (!prefs().terminalSuggestEnabled) {
      hideMenu();
      return;
    }
    const line = currentLine();
    if (line === null) {
      lastLine = "";
      hideMenu();
      return;
    }
    if (line === lastLine) return;
    lastLine = line;
    if (
      dismissedLine !== null &&
      dismissedLine !== line &&
      // Keep the guard while the accepted text's PTY echo lands chunk by
      // chunk (the visible line grows toward dismissedLine) — clearing it
      // here would pop the menu right back over the accepted command.
      !dismissedLine.startsWith(line)
    ) {
      dismissedLine = null;
    }

    // Instant local narrowing of what's already on screen.
    const narrowed = candidates.filter(
      (c) => c.text.startsWith(line) && c.text.length > line.length,
    );
    showCandidates(narrowed);

    if (
      line.trim().length < prefs().terminalSuggestMinChars ||
      dismissedLine === line
    ) {
      return;
    }

    void (async () => {
      // "# task" lines go straight to the model — history can't help.
      const nl = /^\s*#\s*\S/.test(line);
      if (nl && (!ai || !prefs().nlCommandsEnabled)) return;
      const hist = nl ? [] : await historyList(line, 50);
      if (disposed || currentLine() !== line) return;
      const seen = new Set<string>();
      const items: Candidate[] = [];
      for (const h of hist) {
        const t = h.trim();
        if (!t.startsWith(line) || t === line || seen.has(t)) continue;
        seen.add(t);
        items.push({ text: t, ai: false });
        if (items.length >= prefs().terminalSuggestMaxItems) break;
      }
      if (items.length > 0) {
        // History answered — a still-settling AI request for an OLDER line
        // must not come back later and replace these.
        ai?.cancelPending();
        showCandidates(items);
        return;
      }
      // History is silent — ask the model (debounced/cached inside). The
      // answers may extend the typed text OR correct a typo in it.
      if (!ai) return;
      const cands = await ai.suggest(line);
      if (!cands || disposed) return;
      const now = currentLine();
      if (now === null || dismissedLine === now) return;
      // Only show against the line the request was made for — a correction
      // for stale input would erase characters the user just typed.
      const usable = cands.filter(
        (c) => c !== now && (now === line || c.startsWith(now)),
      );
      if (usable.length === 0) return;
      lastLine = now;
      showCandidates(usable.map((text) => ({ text, ai: true })));
    })();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompute, prefs().terminalSuggestDelayMs);
  };

  const subs = [
    term.onWriteParsed(schedule),
    term.onCursorMove(schedule),
    // Scrolling detaches the anchor from view; an invisible menu must not
    // keep swallowing Tab/arrows/Escape.
    term.onScroll(() => {
      if (candidates.length > 0) hideMenu();
    }),
  ];

  /** Last ~25 buffer rows above the cursor — command output tail for Fix. */
  const bufferTail = (): string => {
    const buf = term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const start = Math.max(0, end - 25);
    const rows: string[] = [];
    for (let r = start; r <= end; r++) {
      const l = buf.getLine(r);
      if (l) rows.push(l.translateToString(true));
    }
    return rows.join("\n").trim();
  };

  const offerFix = (req: NonNullable<typeof pendingFix>) => {
    const epoch = inputEpoch;
    void fixFailedCommand({ ...req, cwd: opts.getCwd() })
      .then((fixed) => {
        if (!fixed || disposed || !atInput) return;
        // Another command ran since this failure — the fix is out of
        // context; and only while the prompt is still empty.
        if (epoch !== inputEpoch) return;
        if ((currentLine() ?? "") !== "") return;
        showCandidates([{ text: fixed, ai: true, fix: true }]);
      })
      .catch(() => {});
  };

  return {
    onInputStart: () => {
      const buf = term.buffer.active;
      atInput = true;
      inputEpoch++;
      inputLine = buf.baseY + buf.cursorY;
      inputCol = buf.cursorX;
      lastLine = "";
      dismissedLine = null;
      hideMenu();
      if (pendingFix) {
        const req = pendingFix;
        pendingFix = null;
        offerFix(req);
      }
    },
    onCommandState: (running, command, exitCode) => {
      atInput = false;
      lastLine = "";
      dismissedLine = null;
      hideMenu();
      if (running && command) lastCommand = command;
      if (!running) {
        // D with a non-zero code: remember the failure for the next prompt.
        if (
          allowAi &&
          exitCode != null &&
          exitCode !== 0 &&
          lastCommand &&
          prefs().terminalSuggestEnabled &&
          prefs().failedCommandAi
        ) {
          pendingFix = { command: lastCommand, output: bufferTail(), exitCode };
          lastCommand = "";
        }
        // A finished command likely added a history entry worth suggesting.
        refreshRecent();
      }
    },
    onKey: (ev) => {
      if (candidates.length === 0 || ev.type !== "keydown") return false;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
      // NvChad-style: Tab cycles the highlight (blocked from the shell
      // while the menu is open), Shift+Tab cycles backwards.
      if (ev.key === "Tab") {
        selected = ev.shiftKey
          ? (selected - 1 + candidates.length) % candidates.length
          : (selected + 1) % candidates.length;
        renderRows();
        return true;
      }
      if (ev.shiftKey) return false;
      if (ev.key === "ArrowDown") {
        selected = (selected + 1) % candidates.length;
        renderRows();
        return true;
      }
      if (ev.key === "ArrowUp") {
        selected = (selected - 1 + candidates.length) % candidates.length;
        renderRows();
        return true;
      }
      if (ev.key === "ArrowRight" || ev.key === "End") {
        accept(selected);
        return true;
      }
      if (ev.key === "Escape") {
        dismissedLine = lastLine;
        hideMenu();
        return true;
      }
      return false;
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      for (const s of subs) s.dispose();
      hideMenu();
      ai?.dispose();
    },
  };
}
