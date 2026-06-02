---
phase: quick-strip-visual-wraps
reviewed: 2026-05-30T02:15:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/modules/terminal/lib/selectionText.ts
  - src/modules/terminal/lib/selectionText.test.ts
  - src/modules/terminal/lib/rendererPool.ts
  - src/modules/terminal/lib/useTerminalSession.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase quick: Code Review Report

**Reviewed:** 2026-05-30T02:15:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Feature: strip visual (soft-wrap) line breaks from terminal copy/paste using `IBufferLine.isWrapped`. Core `getSelectionText` utility is solid with good test coverage (17 cases). Integration into `rendererPool.ts` has a Critical issue with silent clipboard write failure, and two Warnings around event listener lifecycle consistency.

## Critical Issues

### CR-01: `copyTextToClipboard` silently swallows clipboard write failures

**File:** `src/modules/terminal/lib/rendererPool.ts:730-732`
**Issue:** The `copyTextToClipboard` helper used by the Ctrl+Shift+C keydown handler discards all rejection reasons with `.catch(() => {})`. If `navigator.clipboard.writeText()` fails (permission denied, insecure context, WebView2 restriction), the user gets no error feedback and the clipboard is left unchanged or stale. Unlike the capture-phase `copy` event handler (which uses the synchronous, reliable `clipboardData.setData()`), the Ctrl+Shift+C path has no fallback. The user presses the copy shortcut, sees no error, and assumes nothing happened.

Additionally, `navigator.clipboard.writeText()` can fail in Tauri 2 WebView2 when not triggered from a user gesture context if the async microtask boundary is crossed. The keydown handler IS a user gesture, so this should work in principle, but the swallowed error means we can never diagnose failures in the field.

**Fix:**
```typescript
function copyTextToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch((e) => {
    console.warn("[terax] clipboard write failed:", e);
  });
}
```
At minimum, log the error. A more robust fix would fall back to dispatching a programmatic copy event via a hidden textarea with `document.execCommand("copy")`, though that API is deprecated. For now, logging is the minimum fix; the capture-phase handler (`clipboardData.setData`) covers the browser-native copy paths and is the reliable path.

## Warnings

### WR-01: `copyListener` listener removed in `detachSlotFromLeaf` but not re-registered on re-bind

**File:** `src/modules/terminal/lib/rendererPool.ts:514-520`
**Issue:** In `detachSlotFromLeaf`, the `copy` event listener is removed from `slot.host` and `slot.copyListener` is set to `null`. The listener is only added in `createSlot()`. Because `slot.host` persists across bind/unbind cycles (it's moved to the recycler div, not destroyed), removing the listener during detach means the slot loses its copy interception permanently if no re-registration happens on the next `bindSlot`. Currently `bindSlot` does NOT re-add the copy listener because `createSlot` is the only place it's registered.

In practice, `detachSlotFromLeaf` is called when the host element is moved to the recycler. When the slot is later re-acquired via `acquireSlot`, `bindSlot` is called which re-appends `slot.host` into the new container. The DOM element is the same, so `addEventListener` would need to be called again since we called `removeEventListener` in detach. The slot now has no copy interception.

This is partially mitigated because slot eviction is rare (pool max 5 slots, LRU eviction) and the primary copy path on Windows is Ctrl+Shift+C (handled by `attachCustomKeyEventHandler`, not the `copy` event). But on macOS, Cmd+C relies on the `copy` event listener, so a reacquired slot would lose Cmd+C copy interception.

**Fix:** Either (a) don't remove the listener in `detachSlotFromLeaf` since the DOM element persists and re-registering is unnecessary overhead, or (b) re-register in `bindSlot`. Option (a) is simpler and correct — the host element is reused, there's no leak:

```typescript
function detachSlotFromLeaf(slot: Slot): void {
  // Do NOT remove copyListener here — the host element persists
  // across bind/unbind cycles and the listener remains valid.
  // It is only removed when the slot is garbage-collected (never,
  // since the pool is bounded). Remove the cleanup block:
  // if (slot.copyListener) {
  //   slot.host.removeEventListener("copy", slot.copyListener, true);
  //   slot.copyListener = null;
  // }

  for (const d of slot.oscDisposers) { ... }
```

Or if removing is preferred for hygiene, add re-registration in `bindSlot`:
```typescript
function bindSlot(slot: Slot, p: AcquireParams): void {
  // Re-register copy listener if it was removed during detach
  if (!slot.copyListener) {
    const copyHandler = (e: ClipboardEvent) => { /* same body */ };
    slot.host.addEventListener("copy", copyHandler, true);
    slot.copyListener = copyHandler;
  }
  // ... rest of bindSlot
```

### WR-02: `getBuffer` callback does not strip visual wraps (inconsistency with `getSelection`)

**File:** `src/modules/terminal/lib/useTerminalSession.ts:483-497`
**Issue:** The `getBuffer` callback (used by the AI subsystem for live terminal context) joins all buffer lines with `"\n"` regardless of `isWrapped`. This means the AI agent sees visual-wrap line breaks as real newlines in the terminal buffer, while `getSelection` (also used by AI for selection attachments) correctly strips them. This inconsistency could cause the AI to misinterpret terminal output — e.g., a long command that soft-wraps appears as multiple short lines to the AI when reading the buffer, but as one line when reading a selection.

Whether to fix this depends on whether `getBuffer` should reflect the visual layout or the logical content. For AI context, logical content (stripped wraps) is likely more useful since the AI needs to understand the command semantics, not the display layout.

**Fix:** If consistent behavior is desired, apply the same `isWrapped` logic to `getBuffer`:
```typescript
const getBuffer = useCallback(
  (maxLines = 200): string | null => {
    const s = sessions.get(leafId);
    if (!s) return null;
    const slot = getSlotForLeaf(leafId);
    if (slot) {
      const buf = slot.term.buffer.active;
      const total = buf.length;
      const parts: { text: string; wrapped: boolean }[] = [];
      const start = Math.max(0, total - maxLines);
      for (let i = start; i < total; i++) {
        const line = buf.getLine(i);
        if (!line) continue;
        parts.push({ text: line.translateToString(true), wrapped: line.isWrapped });
      }
      while (parts.length && parts[parts.length - 1].text === "") parts.pop();
      let result = parts[0]?.text ?? "";
      for (let i = 1; i < parts.length; i++) {
        if (parts[i].wrapped) result += parts[i].text;
        else result += "\n" + parts[i].text;
      }
      return result || null;
    }
    // snapshot fallback unchanged...
  },
  [leafId],
);
```

## Info

### IN-01: `copyTextToClipboard` could be inlined or shared more explicitly

**File:** `src/modules/terminal/lib/rendererPool.ts:730-732`
**Issue:** `copyTextToClipboard` is a single-use one-liner that sits 500+ lines away from its only call site (line 207). It adds no abstraction over the direct `navigator.clipboard.writeText()` call. If it grows (e.g., adding the logging from CR-01 or a fallback), a named function is warranted. Currently it's borderline — not wrong, but the name and distance from the call site add marginal cognitive overhead for little benefit.

**Fix:** No action required. If CR-01 is fixed by adding logging, the function justifies its existence.

---

_Reviewed: 2026-05-30T02:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_