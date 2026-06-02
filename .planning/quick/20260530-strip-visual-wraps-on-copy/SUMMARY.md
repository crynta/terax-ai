---
status: complete
phase: quick
slug: strip-visual-wraps-on-copy
date: 2026-05-30
---

## Summary

Stripped visual (soft-wrap) line breaks from terminal copy/paste and AI selection.

### Problem
When a user selected text in the terminal that spanned soft-wrapped (visual word-wrap) lines and copied it, the clipboard text included spurious newlines at every visual wrap boundary. This made pasting terminal output into editors or other programs produce broken, hard-wrapped text.

### Solution
Created `getSelectionText(term)` utility that reads the buffer selection range and uses `IBufferLine.isWrapped` to distinguish visual wraps from real line breaks. Wrapped lines are joined without a separator; real line breaks produce `\n`.

Wired into three paths:
1. **Ctrl+Shift+C** (Linux/Windows) in `rendererPool.ts` - replaced `term.getSelection()` with `getSelectionText(term)`
2. **macOS Cmd+C** - added `copy` event listener on terminal host element (browsers handle Cmd+C natively; `attachCustomKeyEventHandler` only intercepts Ctrl+Shift+C)
3. **AI `getSelection()`** callback in `useTerminalSession.ts` - same swap, so AI attachment context also gets wrap-stripped text

### Files Modified
- `src/modules/terminal/lib/selectionText.ts` (new) - `getSelectionText` utility
- `src/modules/terminal/lib/selectionText.test.ts` (new) - 9 test cases
- `src/modules/terminal/lib/rendererPool.ts` - import + swap copy handler + add `copyListener` field/cleanup + macOS copy event
- `src/modules/terminal/lib/useTerminalSession.ts` - import + swap `getSelection` callback

### Verification
- `pnpm exec tsc --noEmit` - passes
- `pnpm test` - 104/104 tests pass (including 9 new selection tests)
- `cargo clippy` - passes (no Rust changes)