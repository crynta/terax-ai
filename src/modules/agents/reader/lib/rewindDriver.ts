import {
  leafScreenText,
  writeToSession,
} from "@/modules/terminal/lib/terminalSessionApi";
import { parseClaudeDialog } from "./claudeDialog";
import {
  inputBoxText,
  isRestoreMenu,
  parseRewindPicker,
  planRewindStep,
  type RestoreChoice,
  restoreKeys,
} from "./rewind";

export type RewindStage =
  | "opening"
  | "finding"
  | "choosing"
  | "restoring"
  | "done";

export type RewindResult =
  | { ok: true; restoredInput: string | null }
  | {
      ok: false;
      reason: string;
      /** The picker or menu is still on screen for the user to finish in the terminal. */
      needsTerminal: boolean;
    };

const STEP_MS = 110;
const OPEN_TIMEOUT_MS = 4000;
const MENU_TIMEOUT_MS = 3000;
const CLOSE_TIMEOUT_MS = 4000;
const MAX_STEPS = 240;
const ESC = "\x1b";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function screen(leafId: number): string {
  return leafScreenText(leafId) ?? "";
}

async function waitFor<T>(
  probe: () => T | null,
  timeoutMs: number,
): Promise<T | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const hit = probe();
    if (hit !== null) return hit;
    if (Date.now() >= until) return null;
    await delay(STEP_MS);
  }
}

/**
 * Restores Claude Code to the point before `prompt` with `/rewind`: opens the
 * picker, moves the selection onto the prompt (re-reading the screen after
 * every key), presses Enter and picks `choice` in the restore menu.
 *
 * Gives up cleanly with Esc when the prompt can't be found; leaves the menu
 * open (`needsTerminal`) when its layout isn't understood.
 */
export async function runRewind(
  leafId: number,
  prompt: string,
  choice: Exclude<RestoreChoice, "cancel">,
  occurrence = 0,
  onStage?: (stage: RewindStage) => void,
): Promise<RewindResult> {
  onStage?.("opening");
  if (!writeToSession(leafId, "/rewind")) {
    return {
      ok: false,
      reason: "The terminal isn't ready.",
      needsTerminal: false,
    };
  }
  await delay(120);
  writeToSession(leafId, "\r");

  const opened = await waitFor(
    () => parseRewindPicker(screen(leafId)),
    OPEN_TIMEOUT_MS,
  );
  if (!opened) {
    return {
      ok: false,
      reason: "Claude's rewind list didn't open.",
      needsTerminal: true,
    };
  }

  onStage?.("finding");
  let lastSelected = "";
  let stuck = 0;
  for (let step = 0; ; step++) {
    if (step > MAX_STEPS) {
      writeToSession(leafId, ESC);
      return {
        ok: false,
        reason: "Couldn't reach that message in Claude's rewind list.",
        needsTerminal: false,
      };
    }
    const picker = parseRewindPicker(screen(leafId));
    if (!picker) {
      await delay(STEP_MS);
      continue;
    }
    const plan = planRewindStep(picker, prompt, occurrence);
    if (plan.kind === "enter") break;
    const selected = picker.items[picker.selectedIndex]?.text ?? "";
    if (plan.kind === "scroll") {
      // The selection stopped moving: the list's end, without the prompt.
      stuck = selected === lastSelected ? stuck + 1 : 0;
      if (stuck >= 3) {
        writeToSession(leafId, ESC);
        return {
          ok: false,
          reason: "That message isn't in Claude's rewind list.",
          needsTerminal: false,
        };
      }
    }
    lastSelected = selected;
    // One arrow at a time: the list may hold rows that can't be selected.
    writeToSession(leafId, plan.keys.slice(0, 3));
    await delay(STEP_MS);
  }

  onStage?.("choosing");
  writeToSession(leafId, "\r");
  const menu = await waitFor(() => {
    const dialog = parseClaudeDialog(screen(leafId));
    return dialog && isRestoreMenu(dialog) ? dialog : null;
  }, MENU_TIMEOUT_MS);
  if (menu) {
    const keys = restoreKeys(menu, choice);
    if (!keys) {
      return {
        ok: false,
        reason: "Claude's restore menu didn't offer that option.",
        needsTerminal: true,
      };
    }
    onStage?.("restoring");
    writeToSession(leafId, keys);
  }
  // No menu: Claude restored straight away (nothing to restore in code).

  const closed = await waitFor(() => {
    const text = screen(leafId);
    const dialog = parseClaudeDialog(text);
    const open =
      parseRewindPicker(text) !== null ||
      (dialog !== null && isRestoreMenu(dialog));
    return open ? null : text;
  }, CLOSE_TIMEOUT_MS);
  if (closed === null) {
    return {
      ok: false,
      reason: "Claude's rewind is still open.",
      needsTerminal: true,
    };
  }
  onStage?.("done");
  return { ok: true, restoredInput: inputBoxText(closed) || null };
}

/**
 * Empties Claude Code's input box (after a rewind put the old prompt back):
 * for each line, end of line, delete to its start, then join it with the line
 * above. Resolves to whether the box reads empty afterwards.
 */
export async function clearClaudeInput(
  leafId: number,
  lineCount: number,
): Promise<boolean> {
  const presses = Math.min(Math.max(1, lineCount) + 1, 60);
  for (let i = 0; i < presses; i++) {
    writeToSession(leafId, "\x05\x15\x7f");
    await delay(25);
  }
  await delay(STEP_MS * 2);
  return !inputBoxText(screen(leafId));
}

/** Resolves once Claude Code's input box is on the pane's screen, or false at `timeoutMs`. */
export async function waitForClaudeReady(
  leafId: number,
  timeoutMs: number,
): Promise<boolean> {
  const ready = await waitFor(
    () => (inputBoxText(screen(leafId)) !== null ? true : null),
    timeoutMs,
  );
  return ready === true;
}
