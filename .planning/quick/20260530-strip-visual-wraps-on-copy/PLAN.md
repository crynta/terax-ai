---
phase: quick
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - src/modules/terminal/lib/selectionText.ts
  - src/modules/terminal/lib/selectionText.test.ts
  - src/modules/terminal/lib/rendererPool.ts
  - src/modules/terminal/lib/useTerminalSession.ts
autonomous: true
requirements: [copy-strip-visual-wraps]

must_haves:
  truths:
    - "Copying text that spans soft-wrapped lines produces no newline at wrap boundaries"
    - "Copying text that spans real line breaks preserves those newlines"
    - "macOS Cmd+C and Linux/Windows Ctrl+Shift+C both produce wrap-stripped text"
    - "AI subsystem getSelection() returns wrap-stripped text"
  artifacts:
    - path: "src/modules/terminal/lib/selectionText.ts"
      provides: "getSelectionText utility that strips visual wraps from terminal selection"
      exports: ["getSelectionText"]
    - path: "src/modules/terminal/lib/selectionText.test.ts"
      provides: "Tests for getSelectionText with mocked buffer lines"
      min_lines: 60
  key_links:
    - from: "src/modules/terminal/lib/rendererPool.ts"
      to: "selectionText.getSelectionText"
      via: "import and call in isTerminalCopy handler"
      pattern: "getSelectionText\\(slot\\.term\\)"
    - from: "src/modules/terminal/lib/useTerminalSession.ts"
      to: "selectionText.getSelectionText"
      via: "import and call in getSelection callback"
      pattern: "getSelectionText\\(slot\\.term\\)"
---

<objective>
Replace raw `term.getSelection()` output with a utility that strips visual (soft-wrap) newlines from the clipboard and AI selection paths, while preserving real line breaks.

Purpose: Users expect copied terminal text to contain only the actual line breaks from the program output, not the visual wraps introduced by the terminal width. Currently, pasting multi-line terminal output into an editor splatters it with spurious line breaks at every soft-wrap point.

Output: `selectionText.ts` utility + test, wired into rendererPool.ts (Ctrl+Shift+C), useTerminalSession.ts (AI getSelection), and a macOS `copy` event listener on the terminal host.
</objective>

<execution_context>
@D:/Workstation/pi-gsd/node_modules/@opengsd/get-shit-done-redux/get-shit-done/workflows/execute-plan.md
@D:/Workstation/pi-gsd/node_modules/@opengsd/get-shit-done-redux/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/modules/terminal/lib/rendererPool.ts
@src/modules/terminal/lib/useTerminalSession.ts
@src/modules/terminal/TerminalPane.tsx
@src/modules/terminal/lib/keymap.test.ts
</context>

<feature>
  <name>Strip visual wraps on terminal copy</name>
  <files>src/modules/terminal/lib/selectionText.ts, src/modules/terminal/lib/selectionText.test.ts</files>
  <behavior>
    getSelectionText(term: Terminal): string | null
    - Returns null when term.hasSelection() is false
    - Returns the single-line text unchanged when selection is within one buffer line
    - For multi-line selection: joins lines where isWrapped===true with empty string, joins lines where isWrapped===false with "\n"
    - For partial-line selections: uses translateToString with column start/end from getSelectionPosition()
    - Empty/whitespace-only lines with isWrapped===false still emit a "\n" between surrounding lines

    Cases:
    - No selection → null
    - Single-line selection "hello" → "hello"
    - Two real lines "abc\ndef" (line2 isWrapped=false) → "abc\ndef"
    - Wrapped line "abcdef" displayed across two visual lines (line2 isWrapped=true) → "abcdef"
    - Mixed: line1 real, line2 wrapped continuation, line3 real → "line1line2\nline3"
    - Partial column: start.x=2, end.x=5 on a single line → translateToString(true, 2, 5)
  </behavior>
  <implementation>
    Create getSelectionText(term) that:
    1. Calls term.getSelectionPosition() → if undefined, return null
    2. Reads term.buffer.active, iterates from start.y to end.y
    3. For each line: buf.getLine(y) → if null skip
    4. On first line: translateToString(true, start.x, line===end line ? end.x : undefined)
    5. On last line (if different from first): translateToString(true, 0, end.x)
    6. On middle lines: translateToString(true)
    7. Join: if line.isWrapped===true, concatenate without separator; if false, join with "\n"
  </implementation>
</feature>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create getSelectionText utility with TDD</name>
  <files>src/modules/terminal/lib/selectionText.ts, src/modules/terminal/lib/selectionText.test.ts</files>
  <behavior>
    - No selection (getSelectionPosition returns undefined) → returns null
    - Single-line selection: start.y === end.y, partial columns → returns translateToString trimmed with column bounds
    - Two real lines (second line isWrapped=false) → returns "line1\nline2"
    - Two visual lines that are one wrapped line (second line isWrapped=true) → returns "line1line2" (no newline)
    - Three lines: line1 real, line2 wrapped, line3 real → "line1line2\nline3"
    - Full-line selection (start.x=0 on first, end.x=term.cols on non-last lines) → standard column extraction with translateToString(true, colStart, colEnd)
  </behavior>
  <action>
    Create selectionText.test.ts first. Mock the Terminal interface minimally: an object with hasSelection(), getSelectionPosition(), and buffer.active with getLine(). Each mock line has isWrapped: boolean and translateToString(trimRight, start?, end?): string.

    Test cases (RED):
    - "returns null when getSelectionPosition is undefined"
    - "returns single-line selection text using column bounds"
    - "joins wrapped lines without newline" (line with isWrapped=true after predecessor)
    - "separates real lines with newline" (isWrapped=false)
    - "handles mixed wrapped and real line breaks"
    - "handles partial column selection on first and last line"

    Then implement selectionText.ts (GREEN):
    Export function getSelectionText(term: Terminal): string | null.
    Use term.getSelectionPosition() to get IBufferRange. If undefined, return null.
    Read start {x, y} and end {x, y}. Iterate from start.y to end.y inclusive.
    For line at index i:
    - If i === start.y and i === end.y: getLine(i).translateToString(true, start.x, end.x)
    - If i === start.y: getLine(i).translateToString(true, start.x)
    - If i === end.y: getLine(i).translateToString(true, 0, end.x)
    - Else: getLine(i).translateToString(true)
    Collect lines into array. Join: walk through, if line.isWrapped is true, concatenate to previous without separator; if false, separate with "\n". Implementation note: build result string by iterating collected line texts alongside their isWrapped flags, not by using Array.join.

    Type Terminal from "@xterm/xterm" as the import type. The function takes Terminal directly since all three call sites already have a Terminal reference (slot.term or slot?.term).
  </action>
  <verify>
    <automated>pnpm exec vitest run src/modules/terminal/lib/selectionText.test.ts</automated>
  </verify>
  <done>
    All tests pass. getSelectionText returns null for no selection, strips wraps for wrapped lines, preserves newlines for real breaks, handles partial column ranges.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire getSelectionText into copy paths and add macOS copy event listener</name>
  <files>src/modules/terminal/lib/rendererPool.ts, src/modules/terminal/lib/useTerminalSession.ts</files>
  <action>
    rendererPool.ts:
    - Add import: `import { getSelectionText } from "./selectionText";`
    - In the isTerminalCopy handler block (around line 202), replace `const sel = slot.term.getSelection();` with `const sel = getSelectionText(slot.term);`. The null-check on the next line (`if (sel)`) already handles the null case, so no further change needed.

    useTerminalSession.ts:
    - Add import: `import { getSelectionText } from "./selectionText";`
    - In the getSelection callback (around line 508), replace `const sel = slot?.term.getSelection() ?? "";` with `const sel = slot ? getSelectionText(slot.term) : null;`. Remove the `.length > 0` guard and return `sel` directly (getSelectionText already returns null for empty/no selection).

    macOS copy event listener (rendererPool.ts):
    Add a `copy` event listener on `slot.host` inside createSlot, right after the `term.onData(...)` subscription. This intercepts the browser's native copy event on macOS (Cmd+C).
    - In the event handler: if `slot.term.hasSelection()`, call `event.preventDefault()`, then `const text = getSelectionText(slot.term)` and `if (text) void navigator.clipboard.writeText(text).catch(() => {})`.
    - Store the cleanup function (returned by `slot.host.addEventListener` does not return a disposable, so use `slot.host.removeEventListener` in detachSlotFromLeaf). Add a `copyListener` field to the Slot type or track it via slot.oscDisposers pattern -- actually, the simplest approach: add the listener directly and use `slot.host` which is cleaned up in detachSlotFromLeaf by moving host to recycler (removing it from DOM removes event listeners on the element). Wait -- moving a DOM node to another parent does not remove event listeners. So register the listener and clean it up in detachSlotFromLeaf.
    - Add `copyListener: ((e: ClipboardEvent) => void) | null` to the Slot type.
    - In createSlot, after `term.onData(...)`: define `const copyListener = (e: ClipboardEvent) => { if (slot.term.hasSelection()) { e.preventDefault(); const text = getSelectionText(slot.term); if (text) void navigator.clipboard.writeText(text).catch(() => {}); } };` then `slot.host.addEventListener("copy", copyListener);` and set `slot.copyListener = copyListener;`.
    - In detachSlotFromLeaf: add `if (slot.copyListener) { slot.host.removeEventListener("copy", slot.copyListener); slot.copyListener = null; }` at the top of the cleanup section.
  </action>
  <verify>
    <automated>pnpm exec tsc --noEmit && pnpm exec vitest run src/modules/terminal/lib/selectionText.test.ts</automated>
  </verify>
  <done>
    rendererPool.ts uses getSelectionText for Ctrl+Shift+C and macOS native copy. useTerminalSession.ts uses getSelectionText for AI attachment getSelection. TypeScript compiles cleanly. Existing tests still pass.
  </done>
</task>

</tasks>

<verification>
- pnpm exec tsc --noEmit passes with zero errors
- pnpm test (all tests) passes
- getSelectionText unit tests cover: no-selection, single-line, wrapped-lines, real-newlines, mixed, partial-columns
</verification>

<success_criteria>
- Copying terminal text with soft-wrapped lines produces clipboard text without visual line breaks
- Copying terminal text with real line breaks preserves them
- macOS Cmd+C and Linux/Windows Ctrl+Shift+C both use wrap-stripping
- AI getSelection() returns wrap-stripped text
- TypeScript compiles, all tests pass
</success_criteria>

<output>
Create `.planning/quick/20260530-strip-visual-wraps-on-copy/01-SUMMARY.md` when done
</output>