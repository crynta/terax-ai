import {
  createShellIntegrationState,
  registerCwdHandler,
} from "@/modules/terminal/lib/osc-handlers";
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import { blockIndexAt, computeRange, type LineRange } from "./blockRange";
import {
  type BlockMode,
  initialModeState,
  modeOf,
  type ModeState,
  reduceMode,
} from "./modeMachine";
import { readRangeText } from "./readBlock";
import type { BlockMeta } from "./types";

const OK_RULER = "#5fb3b3";
const FAIL_RULER = "#e5706b";
const MAX_BLOCKS = 1000;

type Entry = {
  id: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number;
  startMarker: IMarker;
  endMarker: IMarker;
  deco: IDecoration | null;
};

type LiveBlock = {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
  startMarker: IMarker;
  usedAlt: boolean;
};

export type BlockContext = {
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
};

export type PositionedBlock = {
  id: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  running: boolean;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  top: number;
  bottom: number;
  // Pixel top of the header row (one line above the command, in the blank gap).
  headerTop: number;
};

export type VisibleBlocks = {
  blocks: PositionedBlock[];
  sticky: PositionedBlock | null;
};

export type BlockMatch = { line: number; col: number; len: number };

export type BlockDecorationsOptions = {
  onCwd?: (cwd: string) => void;
  onMode?: (mode: BlockMode) => void;
  onViewport?: () => void;
};

export class BlockDecorations {
  private readonly entries: Entry[] = [];
  private live: LiveBlock | null = null;
  private cwd = "";
  private idSeq = 0;
  private searchDeco: IDecoration | null = null;
  private searchMarker: IMarker | null = null;
  private mode: ModeState = initialModeState();
  private lastMode: BlockMode = modeOf(initialModeState());
  private readonly shellState = createShellIntegrationState();
  private readonly disposers: (() => void)[] = [];
  private readonly onCwd?: (cwd: string) => void;
  private readonly onMode?: (mode: BlockMode) => void;
  private readonly onViewport?: () => void;
  private viewportRaf: number | null = null;

  constructor(
    private readonly term: Terminal,
    opts?: BlockDecorationsOptions,
  ) {
    this.onCwd = opts?.onCwd;
    this.onMode = opts?.onMode;
    this.onViewport = opts?.onViewport;
    this.term.options.cursorInactiveStyle = "none";
    const osc133 = term.parser.registerOscHandler(133, (data) => {
      this.onOsc133(data);
      return true;
    });
    const cwd = registerCwdHandler(
      term,
      (c) => {
        this.cwd = c;
        this.onCwd?.(c);
      },
      this.shellState,
    );
    const parsed = term.onWriteParsed(() => this.syncAlt());
    const scroll = term.onScroll(() => this.scheduleViewport());
    const render = term.onRender(() => this.scheduleViewport());
    this.disposers.push(
      () => osc133.dispose(),
      cwd,
      () => parsed.dispose(),
      () => scroll.dispose(),
      () => render.dispose(),
    );
  }

  private scheduleViewport(): void {
    if (this.viewportRaf != null) return;
    this.viewportRaf = requestAnimationFrame(() => {
      this.viewportRaf = null;
      this.onViewport?.();
    });
  }

  syncAlt(): void {
    const alt = this.term.buffer.active.type === "alternate";
    if (alt === this.mode.altScreen) return;
    this.mode = reduceMode(this.mode, { type: "altScreen", active: alt });
    if (alt && this.live) this.live.usedAlt = true;
    this.emitMode();
    this.scheduleViewport();
  }

  getBlocks(): BlockMeta[] {
    const out: BlockMeta[] = [];
    for (const e of this.entries) {
      const r = this.rangeOf(e);
      if (r) out.push(this.toMeta(e, r));
    }
    return out;
  }

  blockAt(line: number): BlockMeta | null {
    const ranges = this.entries.map((e) => this.rangeOf(e));
    const i = blockIndexAt(ranges, line);
    if (i < 0) return null;
    const r = ranges[i];
    return r ? this.toMeta(this.entries[i], r) : null;
  }

  read(block: BlockMeta): BlockContext {
    const e = this.entries.find((x) => x.id === block.id);
    const r = e ? this.rangeOf(e) : null;
    const start = r ? r.start : block.startLine;
    const end = r ? r.end : block.endLine;
    return {
      command: block.command,
      cwd: block.cwd,
      exitCode: block.exitCode,
      output: readRangeText(this.term, start, end),
    };
  }

  readById(id: string): BlockContext | null {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return null;
    const r = this.rangeOf(e);
    if (!r) return null;
    return {
      command: e.command,
      cwd: e.cwd,
      exitCode: e.exitCode,
      output: readRangeText(this.term, r.start, r.end),
    };
  }

  searchBlock(id: string, query: string): BlockMatch[] {
    const e = this.entries.find((x) => x.id === id);
    if (!e || !query) return [];
    const r = this.rangeOf(e);
    if (!r) return [];
    const q = query.toLowerCase();
    const buf = this.term.buffer.active;
    const last = Math.min(r.end, buf.length - 1);
    const out: BlockMatch[] = [];
    for (let i = r.start; i <= last && out.length < 500; i++) {
      const lower = buf.getLine(i)?.translateToString(true).toLowerCase() ?? "";
      let from = 0;
      while (out.length < 500) {
        const idx = lower.indexOf(q, from);
        if (idx < 0) break;
        out.push({ line: i, col: idx, len: query.length });
        from = idx + Math.max(1, query.length);
      }
    }
    return out;
  }

  revealMatch(m: BlockMatch): void {
    this.clearSearch();
    try {
      const buf = this.term.buffer.active;
      this.term.scrollToLine(Math.max(0, m.line - Math.floor(this.term.rows / 2)));
      const marker = this.term.registerMarker(m.line - (buf.baseY + buf.cursorY));
      if (!marker) return;
      this.searchMarker = marker;
      this.searchDeco =
        this.term.registerDecoration({ marker, x: m.col, width: m.len }) ?? null;
      this.searchDeco?.onRender((el) => el.classList.add("bt-match"));
    } catch {}
  }

  clearSearch(): void {
    try {
      this.searchDeco?.dispose();
    } catch {}
    try {
      this.searchMarker?.dispose();
    } catch {}
    this.searchDeco = null;
    this.searchMarker = null;
  }

  commandLines(): number[] {
    const lines: number[] = [];
    for (const e of this.entries) {
      if (!e.startMarker.isDisposed && e.startMarker.line >= 0)
        lines.push(e.startMarker.line);
    }
    return lines;
  }

  hoverAt(
    clientY: number,
  ): { block: BlockMeta; top: number; bottom: number } | null {
    const screen = this.term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || this.term.rows === 0) return null;
    const rect = screen.getBoundingClientRect();
    const cellHeight = rect.height / this.term.rows;
    if (cellHeight <= 0) return null;
    const viewportY = this.term.buffer.active.viewportY;
    const row = Math.floor((clientY - rect.top) / cellHeight);
    const block = this.blockAt(viewportY + row);
    if (!block) return null;
    const offset = rect.top - (this.term.element?.getBoundingClientRect().top ?? rect.top);
    const top = offset + Math.max(0, (block.startLine - viewportY) * cellHeight);
    const bottom = offset + (block.endLine - viewportY + 1) * cellHeight;
    return { block, top, bottom };
  }

  visibleBlocks(): VisibleBlocks {
    const term = this.term;
    // No block chrome over a full-screen TUI (vim/htop) — it owns the screen.
    if (this.mode.altScreen) return { blocks: [], sticky: null };
    const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || term.rows === 0) return { blocks: [], sticky: null };
    const rect = screen.getBoundingClientRect();
    const cellHeight = rect.height / term.rows;
    if (cellHeight <= 0) return { blocks: [], sticky: null };
    const elTop = term.element?.getBoundingClientRect().top ?? rect.top;
    const offset = rect.top - elTop;
    const buf = term.buffer.active;
    const viewportY = buf.viewportY;
    const vpTop = viewportY;
    const vpBottom = viewportY + term.rows;

    const out: PositionedBlock[] = [];
    let sticky: PositionedBlock | null = null;

    const consider = (
      meta: Omit<PositionedBlock, "top" | "bottom" | "ok" | "headerTop">,
      startLine: number,
      endLine: number,
    ) => {
      if (endLine < vpTop || startLine > vpBottom) return;
      const ok = meta.exitCode === 0 || meta.exitCode === null;
      const top = offset + (startLine - viewportY) * cellHeight;
      const bottom = offset + (endLine - viewportY + 1) * cellHeight;
      const pb: PositionedBlock = {
        ...meta,
        ok,
        top,
        bottom,
        // The C marker lands on the first output line, so the command echo is
        // one row above `top` and the blank header gap is two rows above.
        headerTop: top - 1.9 * cellHeight,
      };
      out.push(pb);
      if (startLine < vpTop && endLine >= vpTop) sticky = pb;
    };

    // entries are chronological, so once a block starts below the viewport all
    // later ones do too — stop early instead of scanning the whole history.
    for (const e of this.entries) {
      const r = this.rangeOf(e);
      if (!r) continue;
      if (r.start > vpBottom) break;
      consider(
        {
          id: e.id,
          command: e.command,
          cwd: e.cwd,
          exitCode: e.exitCode,
          running: false,
          startedAt: e.startedAt,
          finishedAt: e.finishedAt,
        },
        r.start,
        r.end,
      );
    }

    const lb = this.live;
    if (lb && !lb.startMarker.isDisposed && lb.startMarker.line >= 0) {
      const start = lb.startMarker.line;
      const end = Math.max(start, buf.baseY + buf.cursorY);
      consider(
        {
          id: lb.id,
          command: lb.command,
          cwd: lb.cwd,
          exitCode: null,
          running: true,
          startedAt: lb.startedAt,
          finishedAt: 0,
        },
        start,
        end,
      );
    }

    return { blocks: out, sticky };
  }

  selectBlockAt(clientY: number): void {
    const screen = this.term.element?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || this.term.rows === 0) return;
    const rect = screen.getBoundingClientRect();
    const cellHeight = rect.height / this.term.rows;
    if (cellHeight <= 0) return;
    const row = Math.floor((clientY - rect.top) / cellHeight);
    const bufferRow = this.term.buffer.active.viewportY + row;
    const block = this.blockAt(bufferRow);
    if (block) this.term.selectLines(block.startLine, block.endLine);
    else this.term.clearSelection();
  }

  dispose(): void {
    if (this.viewportRaf != null) cancelAnimationFrame(this.viewportRaf);
    this.clearSearch();
    for (const e of this.entries) this.disposeEntry(e);
    this.entries.length = 0;
    this.live?.startMarker.dispose();
    this.live = null;
    for (const d of this.disposers) {
      try {
        d();
      } catch {}
    }
    this.disposers.length = 0;
  }

  private rangeOf(e: Entry): LineRange | null {
    return computeRange(e.startMarker, e.endMarker);
  }

  private toMeta(e: Entry, r: LineRange): BlockMeta {
    return {
      id: e.id,
      command: e.command,
      cwd: e.cwd,
      exitCode: e.exitCode,
      startLine: r.start,
      endLine: r.end,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
    };
  }

  private emitMode(): void {
    const m = modeOf(this.mode);
    if (m === this.lastMode) return;
    this.lastMode = m;
    this.onMode?.(m);
  }

  private onOsc133(data: string): void {
    const marker = data[0];
    const rest = data.length > 2 && data[1] === ";" ? data.slice(2) : "";
    switch (marker) {
      case "A":
        this.shellState.inCommand = false;
        this.mode = reduceMode(this.mode, { type: "osc133", marker: "A" });
        break;
      case "B":
        this.shellState.inCommand = true;
        this.mode = reduceMode(this.mode, { type: "osc133", marker: "B" });
        break;
      case "C":
        this.shellState.inCommand = true;
        this.mode = reduceMode(this.mode, { type: "osc133", marker: "C" });
        this.startBlock(rest);
        break;
      case "D":
        this.shellState.inCommand = false;
        this.finishBlock(rest);
        this.mode = reduceMode(this.mode, { type: "osc133", marker: "D" });
        break;
    }
    this.emitMode();
  }

  private startBlock(commandFromMarker: string): void {
    if (this.live) this.finishBlock("");
    const marker = this.term.registerMarker(0);
    if (!marker) return;
    this.live = {
      id: `b${++this.idSeq}`,
      command: commandFromMarker,
      cwd: this.cwd,
      startedAt: Date.now(),
      startMarker: marker,
      usedAlt: false,
    };
    this.scheduleViewport();
  }

  private finishBlock(codeStr: string): void {
    const lb = this.live;
    if (!lb) return;
    this.live = null;
    const exit = parseExitCode(codeStr);
    const ok = exit === 0 || exit === null;
    const endMarker = this.term.registerMarker(0);
    if (!endMarker) {
      lb.startMarker.dispose();
      return;
    }
    // Only the scrollbar overview mark; the visible divider is drawn full-width
    // in the host overlay (xterm decorations stop at the padded content edge).
    const deco =
      this.term.registerDecoration({
        marker: endMarker,
        width: 1,
        overviewRulerOptions: { color: ok ? OK_RULER : FAIL_RULER },
      }) ?? null;
    this.entries.push({
      id: lb.id,
      command: lb.command,
      cwd: lb.cwd,
      exitCode: exit,
      startedAt: lb.startedAt,
      finishedAt: Date.now(),
      startMarker: lb.startMarker,
      endMarker,
      deco,
    });
    while (this.entries.length > MAX_BLOCKS) {
      const old = this.entries.shift();
      if (old) this.disposeEntry(old);
    }
    this.scheduleViewport();
  }

  private disposeEntry(e: Entry): void {
    try {
      e.deco?.dispose();
    } catch {}
    try {
      e.startMarker.dispose();
    } catch {}
    try {
      e.endMarker.dispose();
    } catch {}
  }
}

function parseExitCode(s: string): number | null {
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
