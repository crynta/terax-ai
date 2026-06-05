import {
  createShellIntegrationState,
  registerCwdHandler,
} from "@/modules/terminal/lib/osc-handlers";
import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import {
  type BlockMode,
  initialModeState,
  type ModeState,
  modeOf,
  reduceMode,
} from "./modeMachine";
import { readRangeText } from "./readBlock";
import type { BlockMeta } from "./types";

const OK_BORDER = "rgba(95, 179, 179, 0.4)";
const FAIL_BORDER = "rgba(229, 112, 107, 0.55)";
const OK_RULER = "#5fb3b3";
const FAIL_RULER = "#e5706b";
const MAX_BLOCKS = 1000;

type Entry = {
  meta: BlockMeta;
  marker: IMarker;
  endMarker: IMarker | null;
  deco: IDecoration | null;
};

type LiveBlock = {
  id: string;
  command: string;
  cwd: string;
  marker: IMarker;
  usedAlt: boolean;
};

export type BlockContext = {
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
};

export type BlockDecorationsOptions = {
  onCwd?: (cwd: string) => void;
  onMode?: (mode: BlockMode) => void;
};

export class BlockDecorations {
  private readonly entries: Entry[] = [];
  private live: LiveBlock | null = null;
  private cwd = "";
  private idSeq = 0;
  private mode: ModeState = initialModeState();
  private lastMode: BlockMode = modeOf(initialModeState());
  private readonly shellState = createShellIntegrationState();
  private readonly disposers: (() => void)[] = [];
  private readonly onCwd?: (cwd: string) => void;
  private readonly onMode?: (mode: BlockMode) => void;

  constructor(
    private readonly term: Terminal,
    opts?: BlockDecorationsOptions,
  ) {
    this.onCwd = opts?.onCwd;
    this.onMode = opts?.onMode;
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
    this.disposers.push(() => osc133.dispose(), cwd, () => parsed.dispose());
  }

  syncAlt(): void {
    const alt = this.term.buffer.active.type === "alternate";
    if (alt === this.mode.altScreen) return;
    this.mode = reduceMode(this.mode, { type: "altScreen", active: alt });
    if (alt && this.live) this.live.usedAlt = true;
    this.emitMode();
  }

  getBlocks(): BlockMeta[] {
    return this.entries.map((e) => e.meta);
  }

  blockAt(line: number): BlockMeta | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const m = this.entries[i].meta;
      if (line >= m.startLine && line <= m.endLine) return m;
    }
    return null;
  }

  read(block: BlockMeta): BlockContext {
    return {
      command: block.command,
      cwd: block.cwd,
      exitCode: block.exitCode,
      output: readRangeText(this.term, block.startLine, block.endLine),
    };
  }

  commandLines(): number[] {
    const lines: number[] = [];
    for (const e of this.entries) {
      if (!e.marker.isDisposed && e.marker.line >= 0) lines.push(e.marker.line);
    }
    return lines;
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
    for (const e of this.entries) {
      try {
        e.deco?.dispose();
      } catch {}
      try {
        e.marker.dispose();
      } catch {}
      try {
        e.endMarker?.dispose();
      } catch {}
    }
    this.entries.length = 0;
    this.live?.marker.dispose();
    this.live = null;
    for (const d of this.disposers) {
      try {
        d();
      } catch {}
    }
    this.disposers.length = 0;
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
      marker,
      usedAlt: false,
    };
  }

  private finishBlock(codeStr: string): void {
    const lb = this.live;
    if (!lb) return;
    this.live = null;
    const start = lb.marker.line;
    const buf = this.term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const exit = parseExitCode(codeStr);
    const ok = exit === 0 || exit === null;
    const endMarker = this.term.registerMarker(0);
    const deco = endMarker
      ? (this.term.registerDecoration({
          marker: endMarker,
          x: 0,
          width: this.term.cols,
          overviewRulerOptions: { color: ok ? OK_RULER : FAIL_RULER },
        }) ?? null)
      : null;
    if (deco) {
      deco.onRender((el) => {
        el.style.borderBottom = `1px solid ${ok ? OK_BORDER : FAIL_BORDER}`;
        el.style.pointerEvents = "none";
      });
    }
    this.entries.push({
      meta: {
        id: lb.id,
        command: lb.command,
        cwd: lb.cwd,
        exitCode: exit,
        startLine: start,
        endLine: end,
      },
      marker: lb.marker,
      endMarker,
      deco,
    });
    while (this.entries.length > MAX_BLOCKS) {
      const old = this.entries.shift();
      if (!old) break;
      try {
        old.deco?.dispose();
      } catch {}
      try {
        old.marker.dispose();
      } catch {}
      try {
        old.endMarker?.dispose();
      } catch {}
    }
  }
}

function parseExitCode(s: string): number | null {
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
