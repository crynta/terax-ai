---
phase: windows-input-fixes
reviewed: 2026-05-29T15:56:50Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - src/modules/terminal/lib/keymap.ts
  - src/modules/terminal/lib/rendererPool.ts
  - src/modules/terminal/lib/keymap.test.ts
  - src-tauri/src/modules/pty/da_filter.rs
  - src/styles/globals.css
  - src/modules/ai/components/AiInputBar.tsx
  - src/modules/ai/config.ts
  - src/modules/source-control/SourceControlPanel.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase windows-input-fixes: Code Review Report

**Reviewed:** 2026-05-29T15:56:50Z
**Depth:** Deep — per-file analysis with cross-module call-chain tracing
**Files Reviewed:** 8 (5 changed by this branch, 3 unchanged)
**Status:** issues_found

## Summary

Reviewed the Windows terminal input handling branch covering IME overflow fix, AltGr shortcut guard, Ctrl+Shift+Enter/newline dispatch, PowerShell DA filter simplification, and Ctrl+Shift+V paste. Two files listed for review (`config.ts`, `SourceControlPanel.tsx`) have **no changes in this branch** — they are included in the file list but carry no diff.

The core keymap logic is well-structured with an AltGraph guard, an explicit allowed-key allowlist, and a CSI-u escape sequence generator for terminal shortcuts. The DA filter rewrite to a pure pass-through is correct. The CSS IME fix is targeted and safe.

Three findings surfaced that warrant attention: a CSI-u keyboard protocol modifier value that encodes Ctrl+Alt instead of the correct Ctrl+Shift (non-conformant to the kitty spec), a theoretical AltGraph bypass on browsers that don't expose `getModifierState("AltGraph")`, and a silent-but-harmful clipboard error suppression pattern.

## Warnings

### WR-01: CSI-u modifier value 6 encodes Ctrl+Alt instead of Ctrl+Shift (kitty keyboard protocol non-conformance)

**File:** `src/modules/terminal/lib/keymap.ts:47`
**Issue:** `terminalGsdShortcutSequence` generates `\x1b[${key.charCodeAt(0)};6u` for Ctrl+Shift+G/N inputs. In the kitty keyboard protocol, the modifier field is a bitmask: Shift=1, Alt=2, Ctrl=4, Super=8. Modifier value 6 = Alt(2)+Ctrl(4) = **Ctrl+Alt**, not Ctrl+Shift. The correct modifier for Ctrl+Shift would be 5 (1+4). This means a protocol-conformant parser receiving `\x1b[103;6u` would interpret it as Ctrl+Alt+G rather than Ctrl+Shift+G. The application currently works because it recognizes the specific byte sequences, but any downstream consumer that parses CSI-u according to the kitty specification would decode the wrong modifier.

For comparison, `terminalEditorNewlineSequence` correctly uses modifier value 2 (Shift) for `\x1b[13;2u`.

**Fix:**
```typescript
// Change from:
return `\x1b[${key.charCodeAt(0)};6u`;
// To:
return `\x1b[${key.charCodeAt(0)};5u`;
```
If the receiving application explicitly matches the `6u` sequences, update those matchers accordingly. Also update the corresponding test expectations from `\x1b[103;6u` / `\x1b[110;6u` to `\x1b[103;5u` / `\x1b[110;5u`.

### WR-02: AltGraph input interception risk if `getModifierState("AltGraph")` is unavailable

**File:** `src/modules/terminal/lib/keymap.ts:24,58`
**Issue:** `terminalGsdShortcutSequence` guards against AltGraph with `hasAltGraphModifier(event)`, which calls `event.getModifierState?.("AltGraph") ?? false`. On Windows with international keyboards, pressing AltGr synthesizes `ctrlKey=true + altKey=true` in Chromium. The `getModifierState("AltGraph")` API correctly identifies this on modern Chrome/Edge/Firefox, so the guard works. However, if a browser or WebView runtime does not support the `getModifierState` method (or returns false), the `?? false` fallback means the AltGraph guard is bypassed. On such browsers, Ctrl+Alt+B/G/N/P/V/] would be intercepted by the GSD shortcut handler, swallowing the AltGr character for those six keys.

The risk is mitigated by:
1. The restricted allowlist of only 6 keys (b, g, n, p, v, ])
2. Most AltGr combos for those keys produce rare characters

Still, on Windows Spanish layout AltGr+N types `ñ`, and if the guard fails, the user would lose `ñ` input in the terminal.

**Fix:** Consider adding a secondary heuristic: on Windows (non-Mac), when `ctrlKey && altKey && !shiftKey`, also check whether `event.key` is a printable character different from what `event.code` would produce. If `event.key.length === 1` and is not in `["b","g","n","p","v","]"]`, return null regardless of AltGraph state:

```typescript
if (event.ctrlKey && event.altKey && !event.shiftKey) {
  // If the browser produced a printable key that differs from the
  // code-based letter, this is likely an AltGraph composition —
  // pass it through.
  const key = normalizedKey(event);
  const fromCode = event.code.startsWith("Key") && event.code.length === 4
    ? event.code.slice(3).toLowerCase()
    : null;
  if (fromCode && event.key.length === 1 && event.key.toLowerCase() !== fromCode) {
    return null; // AltGraph composition — don't intercept
  }
  const ctrl = ctrlCharForEvent(event, new Set(["b", "g", "n", "p", "v", "]"]));
  return ctrl ? `\x1b${ctrl}` : null;
}
```

### WR-03: Silent clipboard error suppression in terminal copy/paste handlers

**File:** `src/modules/terminal/lib/rendererPool.ts:226,233`
**Issue:** Both `isTerminalCopy` and `isTerminalPaste` handlers swallow all clipboard API errors with `.catch(() => {})`. If `navigator.clipboard.readText()` or `navigator.clipboard.writeText()` fails (e.g., user denied clipboard permission, or the API is unavailable in a non-HTTPS context), the user receives no feedback — the paste simply does nothing, and copy silently fails. In a Tauri desktop app, clipboard access should normally work, but WebView permission issues or sandbox configurations could cause failures that would be invisible to the user.

While this is a common pattern and not a regression (the previous `isShiftEnter` handler had no clipboard calls), it's worth noting as a quality gap.

**Fix:** At minimum, log the error for debugging:
```typescript
void navigator.clipboard
  .readText()
  .then((text) => {
    if (text) slot.term.paste(text);
  })
  .catch((err) => {
    console.warn("[terax] clipboard read failed:", err);
  });
```

## Info

### IN-01: DA filter hold buffer initial capacity undersized relative to HOLD_MAX

**File:** `src-tauri/src/modules/pty/da_filter.rs:12,14`
**Issue:** `DaFilter::new()` creates the hold buffer with `Vec::with_capacity(16)`, but `HOLD_MAX` is 256. For CSI sequences longer than 16 bytes (e.g., a detailed device attribute response), the buffer will reallocate. This is a minor performance concern, not a correctness issue — reallocation is cheap at these sizes and sequences rarely exceed 16 bytes. For maximum clarity, consider aligning the initial capacity with a reasonable CSI length (e.g., 32 or 64).

**Fix:** `Vec::with_capacity(32)` or `Vec::with_capacity(HOLD_MAX)`. Neither has measurable performance impact.

### IN-02: CSS `.xterm-helpers` override omits `top` and `position` properties

**File:** `src/styles/globals.css:232-243`
**Issue:** The `.xterm .xterm-helpers` override sets `left`, `right`, `bottom`, `width`, `height`, `max-width`, and `overflow`, but omits `top` and `position`. This works because xterm.js already sets `position: absolute` on `.xterm-helpers`, and the vertical position is determined by xterm's dynamic top positioning of the textarea (which positions the IME candidate window at the cursor). However, relying on an upstream stylesheet for `position` creates an implicit coupling — if xterm.js changes its internal styles, this override could fail silently. Consider adding `position: absolute !important;` for defensive completeness.

**Fix:** Add `position: absolute !important;` to the `.xterm .xterm-helpers` block for explicitness.

### IN-03: Unchanged review files carry no branch diff

**Files:** `src/modules/ai/config.ts`, `src/modules/source-control/SourceControlPanel.tsx`
**Issue:** These two files were listed for review but carry no changes in the `pr/windows-input-fixes` branch (confirmed by `git diff`). `config.ts` was described as a "tag change" and `SourceControlPanel.tsx` as a "CSS class fix". Both appear to be either already merged to main or not part of this branch. SourceControlPanel.tsx line 570 contains valid CSS classes (no malformed `border-` found in current working tree). No issues found in these files.

---

_Reviewed: 2026-05-29T15:56:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_