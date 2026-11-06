/**
 * Terax's terminal session API over a VS Code terminal: screen text comes
 * from the host's mirror of the terminal, writes go to `terminal.sendText`.
 * Leaf ids double as pty ids.
 */
import { hostState, writeToTerminal } from "../bridge";

export function leafScreenText(leafId: number): string | null {
  return hostState.leaves.get(leafId)?.screen ?? null;
}

/** The host only mirrors the visible screen; that is the useful tail too. */
export function leafTailText(leafId: number, _lines: number): string | null {
  return leafScreenText(leafId);
}

export function writeToSession(leafId: number, data: string): boolean {
  const leaf = hostState.leaves.get(leafId);
  if (!leaf) return false;
  writeToTerminal(leafId, data);
  return true;
}

export function leafBracketedPaste(leafId: number): boolean {
  return hostState.leaves.get(leafId)?.bracketedPaste ?? true;
}

export function leafCwd(leafId: number): string | null {
  return hostState.leaves.get(leafId)?.cwd ?? null;
}

export function liveLeafIds(): number[] {
  return [...hostState.leaves.values()].filter((l) => l.alive).map((l) => l.leafId);
}

export function ptyIdForLeaf(leafId: number): number | null {
  return hostState.leaves.has(leafId) ? leafId : null;
}

export function leafIdForPty(ptyId: number): number | null {
  return ptyIdForLeaf(ptyId);
}
