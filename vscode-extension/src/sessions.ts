import * as vscode from "vscode";
import { isClaudeCommand, OscSignalParser } from "./osc";
import type { LeafState, ReaderPhase } from "./protocol";
import { ScreenMirror } from "./screen";
import { readScreen, reconcilePhase } from "../../src/modules/agents/lib/phaseRules";

const SCREEN_PUSH_MS = 80;
/** How often each Claude's screen copy is checked against its phase. */
const RECONCILE_MS = 1500;
const FINISHED_TTL_MS = 6000;
/**
 * VS Code's stable API doesn't report a terminal's size, so the mirror is
 * roomy instead: Claude wraps its own output to the real width and moves the
 * cursor relatively, so a wider, taller copy ends with the same text at the
 * bottom (plus a few older lines above it). A copy narrower or shorter than
 * the real terminal is not safe: wrapped rows throw Claude's redraws off, so
 * this stays well above any panel's size.
 */
const MIRROR_COLS = 500;
const MIRROR_ROWS = 120;
/** Scrollback kept in the copy, for `@terminal` context. */
const MIRROR_SCROLLBACK = 1000;

/** One VS Code terminal the Reader can attach to. */
export type Leaf = {
  leafId: number;
  terminal: vscode.Terminal;
  cwd: string | null;
  mirror: ScreenMirror | null;
  execution: vscode.TerminalShellExecution | null;
  phase: ReaderPhase | null;
  sessionId: string | null;
  startedAt: number | null;
  screen: string | null;
  alive: boolean;
  finishedTimer: ReturnType<typeof setTimeout> | null;
  screenTimer: ReturnType<typeof setTimeout> | null;
  /** When `phase` last changed, for the screen check. */
  phaseSince: number;
  /** Screen checks in a row that showed no work while the phase said working. */
  quietReads: number;
};

type Listener = (leaf: Leaf, screenChanged: boolean) => void;

/**
 * Follows Claude runs in VS Code terminals. Shell integration hands over each
 * command's raw output; that stream feeds the hook-marker parser (session id,
 * working / needs-you / done) and an invisible terminal copy (screen text).
 */
export class SessionTracker implements vscode.Disposable {
  private readonly leaves = new Map<vscode.Terminal, Leaf>();
  private nextId = 1;
  private readonly listeners = new Set<Listener>();
  private readonly goneListeners = new Set<(leafId: number) => void>();
  private readonly startListeners = new Set<(leaf: Leaf) => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((e) => this.onStart(e)),
      vscode.window.onDidEndTerminalShellExecution((e) => this.onEnd(e)),
      vscode.window.onDidCloseTerminal((t) => this.onClose(t)),
    );
    const timer = setInterval(() => this.reconcile(), RECONCILE_MS);
    this.disposables.push(new vscode.Disposable(() => clearInterval(timer)));
  }

  /**
   * Corrects each running Claude's phase from its screen: hooks miss turns
   * that end without a Stop (an Esc interrupt, an API error) and the work
   * after a permission answer, so the phase alone could stay "working".
   */
  private reconcile(): void {
    for (const leaf of this.leaves.values()) {
      const mirror = leaf.mirror;
      if (!mirror || !leaf.alive || leaf.phase === null) continue;
      void mirror.flush().then(() => {
        if (leaf.mirror !== mirror || leaf.phase === null) return;
        const text = mirror.screenText();
        const read = readScreen(text);
        const next = reconcilePhase(
          leaf.phase,
          read,
          leaf.quietReads,
          Date.now() - leaf.phaseSince,
        );
        if (leaf.phase === "working" && !read.busy && !read.footer && !read.dialog && next.quietReads === 1) {
          // Claude's screen isn't recognisable: worth seeing why.
          this.log.info(`leaf ${leaf.leafId}: no Claude activity or footer on screen; last lines:\n${text.split("\n").slice(-12).join("\n")}`);
        }
        leaf.quietReads = next.quietReads;
        if (next.phase === null) return;
        this.log.info(`leaf ${leaf.leafId}: screen shows ${next.phase} (was ${leaf.phase})`);
        this.setPhase(leaf, next.phase);
        this.emit(leaf, false);
      });
    }
  }

  onChange(l: Listener): vscode.Disposable {
    this.listeners.add(l);
    return new vscode.Disposable(() => this.listeners.delete(l));
  }

  onGone(l: (leafId: number) => void): vscode.Disposable {
    this.goneListeners.add(l);
    return new vscode.Disposable(() => this.goneListeners.delete(l));
  }

  onClaudeStart(l: (leaf: Leaf) => void): vscode.Disposable {
    this.startListeners.add(l);
    return new vscode.Disposable(() => this.startListeners.delete(l));
  }

  all(): Leaf[] {
    return [...this.leaves.values()];
  }

  /** The leaf already tracked for `terminal`, without creating one. */
  known(terminal: vscode.Terminal): Leaf | undefined {
    return this.leaves.get(terminal);
  }

  byId(leafId: number): Leaf | undefined {
    for (const leaf of this.leaves.values()) if (leaf.leafId === leafId) return leaf;
    return undefined;
  }

  /** The leaf for `terminal`, created on first use (e.g. Claude started before install). */
  leafFor(terminal: vscode.Terminal): Leaf {
    let leaf = this.leaves.get(terminal);
    if (!leaf) {
      leaf = {
        leafId: this.nextId++,
        terminal,
        cwd: terminal.shellIntegration?.cwd?.fsPath ?? cwdFromOptions(terminal),
        mirror: null,
        execution: null,
        phase: null,
        sessionId: null,
        startedAt: null,
        screen: null,
        alive: false,
        finishedTimer: null,
        screenTimer: null,
        phaseSince: Date.now(),
        quietReads: 0,
      };
      this.leaves.set(terminal, leaf);
    }
    return leaf;
  }

  state(leaf: Leaf, withScreen: boolean): LeafState {
    return {
      leafId: leaf.leafId,
      cwd: leaf.cwd,
      screen: withScreen ? leaf.screen : null,
      bracketedPaste: leaf.mirror?.bracketedPaste ?? true,
      phase: leaf.phase,
      sessionId: leaf.sessionId,
      startedAt: leaf.startedAt,
      screenAvailable: leaf.mirror !== null,
      hooksAvailable: leaf.sessionId !== null,
      alive: leaf.alive,
    };
  }

  /** Types `data` into the terminal exactly as given (no newline added). */
  write(leafId: number, data: string): boolean {
    const leaf = this.byId(leafId);
    if (!leaf || leaf.terminal.exitStatus !== undefined) return false;
    leaf.terminal.sendText(data, false);
    return true;
  }

  private onStart(e: vscode.TerminalShellExecutionStartEvent): void {
    if (!isClaudeCommand(e.execution.commandLine.value)) return;
    const leaf = this.leafFor(e.terminal);
    this.log.info(`claude started in "${e.terminal.name}" (leaf ${leaf.leafId}): ${e.execution.commandLine.value}`);
    this.stopRun(leaf);
    leaf.execution = e.execution;
    leaf.mirror = new ScreenMirror(MIRROR_COLS, MIRROR_ROWS, MIRROR_SCROLLBACK);
    leaf.cwd = e.execution.cwd?.fsPath ?? e.shellIntegration.cwd?.fsPath ?? leaf.cwd;
    // At its prompt until the first prompt's hook (or the screen) says work.
    leaf.phase = "idle";
    leaf.phaseSince = Date.now();
    leaf.quietReads = 0;
    leaf.sessionId = null;
    leaf.startedAt = Date.now();
    leaf.screen = null;
    leaf.alive = true;
    this.emit(leaf, true);
    for (const l of this.startListeners) l(leaf);
    void this.pump(leaf, e.execution);
  }

  private async pump(leaf: Leaf, execution: vscode.TerminalShellExecution): Promise<void> {
    const parser = new OscSignalParser();
    const mirror = leaf.mirror;
    try {
      for await (const data of execution.read()) {
        if (leaf.execution !== execution || !mirror) return;
        for (const signal of parser.feed(data)) {
          if (signal.kind === "linked") {
            leaf.sessionId = signal.session;
            this.log.info(`leaf ${leaf.leafId} linked to session ${signal.session}`);
          }
          else this.setPhase(leaf, signal.kind);
          this.emit(leaf, false);
        }
        mirror.write(data);
        this.scheduleScreen(leaf);
      }
    } catch (error) {
      this.log.error(`terminal stream failed: ${String(error)}`);
    }
  }

  private setPhase(leaf: Leaf, phase: ReaderPhase): void {
    if (leaf.finishedTimer) clearTimeout(leaf.finishedTimer);
    leaf.finishedTimer = null;
    if (leaf.phase !== phase) {
      leaf.phaseSince = Date.now();
      leaf.quietReads = 0;
    }
    leaf.phase = phase;
    if (phase === "finished") {
      leaf.finishedTimer = setTimeout(() => {
        leaf.finishedTimer = null;
        if (leaf.phase === "finished") {
          leaf.phase = "idle";
          this.emit(leaf, false);
        }
      }, FINISHED_TTL_MS);
    }
  }

  private scheduleScreen(leaf: Leaf): void {
    if (leaf.screenTimer) return;
    leaf.screenTimer = setTimeout(() => {
      leaf.screenTimer = null;
      const mirror = leaf.mirror;
      if (!mirror) return;
      void mirror.flush().then(() => {
        const next = mirror.screenText();
        if (next === leaf.screen) return;
        leaf.screen = next;
        this.emit(leaf, true);
      });
    }, SCREEN_PUSH_MS);
  }

  /** Tail of the mirrored buffer (for `@terminal` context). */
  tail(leafId: number, lines: number): string | null {
    return this.byId(leafId)?.mirror?.tailText(lines) ?? null;
  }

  private onEnd(e: vscode.TerminalShellExecutionEndEvent): void {
    const leaf = this.leaves.get(e.terminal);
    if (!leaf || leaf.execution !== e.execution) return;
    this.stopRun(leaf);
    leaf.alive = false;
    leaf.phase = null;
    this.emit(leaf, true);
  }

  private stopRun(leaf: Leaf): void {
    if (leaf.finishedTimer) clearTimeout(leaf.finishedTimer);
    if (leaf.screenTimer) clearTimeout(leaf.screenTimer);
    leaf.finishedTimer = null;
    leaf.screenTimer = null;
    leaf.execution = null;
    leaf.mirror?.dispose();
    leaf.mirror = null;
  }

  private onClose(terminal: vscode.Terminal): void {
    const leaf = this.leaves.get(terminal);
    if (!leaf) return;
    this.stopRun(leaf);
    this.leaves.delete(terminal);
    for (const l of this.goneListeners) l(leaf.leafId);
  }

  private emit(leaf: Leaf, screenChanged: boolean): void {
    for (const l of this.listeners) l(leaf, screenChanged);
  }

  dispose(): void {
    for (const leaf of this.leaves.values()) this.stopRun(leaf);
    for (const d of this.disposables) d.dispose();
  }
}

function cwdFromOptions(terminal: vscode.Terminal): string | null {
  const opts = terminal.creationOptions as vscode.TerminalOptions;
  const cwd = opts?.cwd;
  if (!cwd) return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  return typeof cwd === "string" ? cwd : cwd.fsPath;
}
