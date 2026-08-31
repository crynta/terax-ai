import type { BlockMode } from "@/modules/terminal/block/lib/modeMachine";
import {
  clearGhosttySession,
  disposeGhosttySession,
  ghosttyFocusedLeaf,
  ghosttyLeafHasForegroundProcess,
  ghosttyLeafIdForPty,
  ghosttyPtyIdForLeaf,
  hasGhosttySession,
  interruptGhosttySession,
  pasteIntoGhosttySession,
  respawnGhosttySession,
  submitToGhosttySession,
  whenGhosttySessionReady,
  writeToGhosttySession,
} from "@/modules/terminal/ghostty/useGhosttyTerminalSession";
import type * as XtermSessionModule from "./useTerminalSession";

type XtermSessionAdapter = Pick<
  typeof XtermSessionModule,
  | "blockWatermarkState"
  | "clearFocusedTerminal"
  | "clearLeafBlockSelection"
  | "disposeSession"
  | "focusLeafInput"
  | "getLeafBlockMode"
  | "getLeafDraft"
  | "hasXtermSession"
  | "interruptLeaf"
  | "leafCwd"
  | "leafGridSelection"
  | "leafHasForegroundProcess"
  | "leafIdForPty"
  | "navigateFocusedBlocks"
  | "pasteIntoSession"
  | "ptyIdForLeaf"
  | "respawnSession"
  | "setLeafDraft"
  | "setLeafInputActivity"
  | "setLeafInputFocus"
  | "submitToLeaf"
  | "subscribeLeafBlockMode"
  | "whenSessionReady"
  | "writeToSession"
>;

export type WatermarkState = XtermSessionModule.WatermarkState;

let xtermAdapter: XtermSessionAdapter | null = null;
let xtermAdapterPromise: Promise<XtermSessionAdapter> | null = null;

export function registerXtermSessionAdapter(
  adapter: XtermSessionAdapter,
): void {
  xtermAdapter = adapter;
}

async function loadXtermAdapter(): Promise<XtermSessionAdapter> {
  if (xtermAdapter) return xtermAdapter;
  xtermAdapterPromise ??= import("./useTerminalSession").then((module) => {
    xtermAdapter = module;
    return module;
  });
  return xtermAdapterPromise;
}

export async function whenSessionReady(
  leafId: number,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(0, deadline - Date.now());
    if (hasGhosttySession(leafId)) {
      await withTimeout(whenGhosttySessionReady(leafId), remaining);
      return;
    }
    if (xtermAdapter?.hasXtermSession(leafId)) {
      await xtermAdapter.whenSessionReady(leafId, remaining);
      return;
    }
    await delay(Math.min(10, remaining));
  }
}

export function writeToSession(leafId: number, data: string): boolean {
  if (writeToGhosttySession(leafId, data)) return true;
  return xtermAdapter?.writeToSession(leafId, data) ?? false;
}

export function submitToLeaf(leafId: number, text: string): void {
  if (submitToGhosttySession(leafId, text)) return;
  xtermAdapter?.submitToLeaf(leafId, text);
}

export function interruptLeaf(leafId: number): void {
  if (interruptGhosttySession(leafId)) return;
  xtermAdapter?.interruptLeaf(leafId);
}

export function pasteIntoSession(leafId: number, text: string): boolean {
  if (pasteIntoGhosttySession(leafId, text)) return true;
  return xtermAdapter?.pasteIntoSession(leafId, text) ?? false;
}

export function leafCwd(leafId: number): string | null {
  return xtermAdapter?.leafCwd(leafId) ?? null;
}

export function navigateFocusedBlocks(direction: -1 | 1): boolean {
  return xtermAdapter?.navigateFocusedBlocks(direction) ?? false;
}

export function clearLeafBlockSelection(leafId: number): boolean {
  return xtermAdapter?.clearLeafBlockSelection(leafId) ?? false;
}

export function leafGridSelection(leafId: number): string | null {
  return xtermAdapter?.leafGridSelection(leafId) ?? null;
}

export function getLeafBlockMode(leafId: number): BlockMode {
  return xtermAdapter?.getLeafBlockMode(leafId) ?? "prompt";
}

export function subscribeLeafBlockMode(
  leafId: number,
  callback: () => void,
): () => void {
  return xtermAdapter?.subscribeLeafBlockMode(leafId, callback) ?? (() => {});
}

export function setLeafInputFocus(
  leafId: number,
  callback: (() => void) | null,
): void {
  xtermAdapter?.setLeafInputFocus(leafId, callback);
}

export function focusLeafInput(leafId: number): void {
  xtermAdapter?.focusLeafInput(leafId);
}

export function getLeafDraft(leafId: number): string {
  return xtermAdapter?.getLeafDraft(leafId) ?? "";
}

export function setLeafDraft(leafId: number, text: string): void {
  xtermAdapter?.setLeafDraft(leafId, text);
}

export function setLeafInputActivity(leafId: number, active: boolean): void {
  xtermAdapter?.setLeafInputActivity(leafId, active);
}

export function blockWatermarkState(leafId: number): WatermarkState {
  return xtermAdapter?.blockWatermarkState(leafId) ?? "hidden";
}

export function clearFocusedTerminal(): boolean {
  const ghosttyLeaf = ghosttyFocusedLeaf();
  if (ghosttyLeaf !== null) return clearGhosttySession(ghosttyLeaf);
  return xtermAdapter?.clearFocusedTerminal() ?? false;
}

export function leafIdForPty(ptyId: number): number | null {
  return (
    ghosttyLeafIdForPty(ptyId) ?? xtermAdapter?.leafIdForPty(ptyId) ?? null
  );
}

export function ptyIdForLeaf(leafId: number): number | null {
  return (
    ghosttyPtyIdForLeaf(leafId) ?? xtermAdapter?.ptyIdForLeaf(leafId) ?? null
  );
}

export async function respawnSession(
  leafId: number,
  cwd?: string,
): Promise<void> {
  if (await respawnGhosttySession(leafId, cwd)) return;
  await (await loadXtermAdapter()).respawnSession(leafId, cwd);
}

export async function leafHasForegroundProcess(
  leafId: number,
): Promise<boolean> {
  if (hasGhosttySession(leafId)) {
    return ghosttyLeafHasForegroundProcess(leafId);
  }
  return (await loadXtermAdapter()).leafHasForegroundProcess(leafId);
}

export function disposeSession(leafId: number): void {
  if (disposeGhosttySession(leafId)) return;
  xtermAdapter?.disposeSession(leafId);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([promise, delay(timeoutMs)]);
}
