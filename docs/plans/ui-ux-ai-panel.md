# UI/UX Overhaul + AI Panel (visual, stateless)

## Goal
Polish header/tabs UX, fix tab-switch flicker, introduce a persistent status bar with interactive breadcrumb, and an `⌘I`-toggled AI panel (visuals only, wired to Vercel AI Elements), per-tab stateless agent sessions that open in a new Tauri window on click.

## Approach

- **Layout** (top→bottom, static-sized except the split):
  ```
  Header                                          (static)
  ├─ ResizablePanelGroup direction=vertical       (only when AI panel open)
  │   ├─ Terminals (absolute stack)
  │   └─ AiSessionView
  │   — when AI panel closed: Terminals occupies the whole area, no group
  AiInput                                         (static, only when AI panel open)
  StatusBar                                       (static)
  ```
- **One session per tab, not a chat.** No history, no multi-session, no "new chat". Tab = session. Submitting a prompt updates the session for that tab; closing the tab drops it.
- **Theme discipline**: replace hardcoded `bg-white/5|10` with shadcn tokens (`bg-muted`, `bg-accent`, `text-muted-foreground`, `border-border`). Xterm keeps hex (`themes.ts`) — it can't consume CSS vars directly.
- **Smooth tab switch**: swap `display:none` → `visibility:hidden` + `useLayoutEffect`-driven `fit()` on `visible`. Keeps layout alive → no reflow flash. **No** framer-motion on tab switch (would flash with WebGL).
- **Breadcrumb** reads `Tab.cwd` (populated via OSC 7). Clicks dispatch `cd <path>\n` into the active tab's PTY via a `write(data)` imperative handle exposed from `TerminalPane`. Directory dropdown calls a new Rust command `list_subdirs(path)`.
- **Motion (macOS-style)** via `motion` package:
  - AI panel open/close: `AnimatePresence` + `motion.div` slide-up + fade, spring `{ stiffness: 280, damping: 30 }`.
  - Shortcuts Dialog: scale `0.96 → 1` + fade (override shadcn dialog anim if needed).
  - Session content sections: stagger fade-in.
  - Status-bar right cluster: crossfade between "Open AI Agent" button and tools cluster via `AnimatePresence mode="wait"`.
  - Breadcrumb/dropdown: Radix defaults (untouched).
- **Not doing now** (explicitly):
  - Splits / panes
  - Persistence of tabs/sessions across app restarts
  - Real AI logic, model calls, attachments upload, voice recording — *visual only*
  - Editable keybindings
  - Drag-reorder tabs
  - The agent-window *content* (task timeline / thinking / results) — only the window opens; content is a placeholder with the prompt echoed. To be built in a follow-up PR using ai-elements `task`, `reasoning`, `conversation`, etc.

## Files

### New
- `src/modules/shortcuts/ShortcutsDialog.tsx` — shadcn Dialog listing shortcut groups.
- `src/modules/shortcuts/shortcuts.ts` — single source of truth for shortcut definitions (used by dialog + global handler).
- `src/modules/ai/AiPanel.tsx` — vertical layout: `AiSessionView` (inside resizable) + `AiInput` (static).
- `src/modules/ai/AiSessionView.tsx` — session content (empty state or active session's task/reasoning/result via ai-elements).
- `src/modules/ai/AiInput.tsx` — `PromptInput` with rotating placeholder.
- `src/modules/ai/lib/useSession.ts` — per-tab session state (`Map<tabId, Session>`).
- `src/modules/ai/lib/placeholders.ts` — hint placeholders.
- `src/modules/statusbar/StatusBar.tsx` — bottom bar shell.
- `src/modules/statusbar/CwdBreadcrumb.tsx` — interactive breadcrumb + child-dir dropdown.
- `src/modules/statusbar/AiTools.tsx` — right-side tools cluster (attach / model / voice / send) or "Open AI Agent" button with `⌘I` Kbd.
- `src-tauri/src/modules/fs/mod.rs` — `list_subdirs(path: String) -> Vec<String>` (directories only, non-hidden, sorted).

### Changed
- `src/app/App.tsx` — layout, centralized keyboard handler, AI panel/shortcut-dialog state, sessions hook.
- `src/modules/header/Header.tsx` — shortcuts-icon button (left of Settings), responsive rules.
- `src/modules/header/SearchInline.tsx` — embed `Kbd` `⌘F` hint, collapse-to-icon on narrow.
- `src/modules/terminal/TerminalPane.tsx` + `useTerminalSession.ts` — expose `write(data)` imperative handle; switch to `visibility:hidden` + `useLayoutEffect` fit.
- `src/modules/terminal/lib/pty-bridge.ts` — no changes expected; reused by breadcrumb via session handle.
- `src/modules/tabs/TabBar.tsx` — theme token swap only (no structural change — user has already iterated on this).
- `src-tauri/src/lib.rs` + `src-tauri/src/modules/mod.rs` — register `fs::list_subdirs`, `open_agent_window`.
- `src/styles/globals.css` — no functional change unless we find a gap; avoid bloat.

## Steps

1. [ ] `src/modules/shortcuts/shortcuts.ts` + `ShortcutsDialog.tsx` — define data, render groups (General / Tabs / Search / AI). Verify: opens via `⌘K` and via icon click; Esc closes.
2. [ ] `src/app/App.tsx` — refactor keyboard handler to consume `shortcuts.ts`; add `⌃Tab` / `⌃⇧Tab` cycle and `⌘I` toggle. Remove the `useEffect` missing-deps bug (effect reruns every render because there's no dep array). Verify: every shortcut fires exactly once per keypress.
3. [ ] `Header.tsx` + `SearchInline.tsx` — add shortcuts icon, `Kbd ⌘F` inside input (absolute right), swap hardcoded colors → shadcn tokens, collapse search to icon below `md` breakpoint using `hidden md:flex` pattern + popover for icon mode. Verify: at 600px window width, nothing overlaps; search still reachable.
4. [ ] `TerminalPane.tsx` + `useTerminalSession.ts` — switch to `visibility` toggle, move `fit()` into `useLayoutEffect`, expose `{ write }` via `forwardRef` + `useImperativeHandle` so breadcrumb can inject commands. Verify: tab switch has no visible reflow (record/eyeball); `cd` injection lands on the right PTY.
5. [ ] `src-tauri/src/modules/fs/mod.rs` + wiring — implement `list_subdirs`, register command. Verify: `invoke('list_subdirs', { path: '/' })` returns top-level dirs.
6. [ ] `src/modules/statusbar/*` — StatusBar shell, CwdBreadcrumb (home/~ substitution, mid-path truncation with ellipsis), AiTools (conditional right-side content). Verify: breadcrumb `cd` works for each segment; dropdown lists children and navigates.
7. [ ] `App.tsx` layout — introduce `ResizablePanelGroup` vertical between terminal area and AI session view when panel is open. Ensure terminal's `ResizeObserver` picks up drag and debounces `fit()`. Verify: drag the handle; terminal re-flows cleanly, no oversize cursor-row glitch.
8. [ ] `src/modules/ai/*` — `AiSessionView` (empty-state placeholder by default; renders `Task`/`Reasoning`/`Response` from ai-elements when session exists), `AiInput` (PromptInput, random placeholder per mount, Enter = submit), `useSession` per-tab. Verify: submit creates a session rendered inline above input; toggling tabs swaps the session view.
9. [ ] Motion pass — wrap AI panel mount in `AnimatePresence` slide-up; status-bar right-cluster crossfade; dialog scale-fade; session sections stagger. Verify: animations feel mac-native (subtle, springy), no layout thrash.
10. [ ] Theme-token audit — grep for `bg-white`, `text-white/`, raw hex outside `themes.ts`; replace with tokens.
11. [ ] Final smoke: type-check + run app, exercise every shortcut + breadcrumb + AI panel toggle + resize.

## Verification

```
pnpm run check-types   # or tsc --noEmit if not aliased
pnpm tauri dev
```

Manual checklist:
- Tab switch: no flash/reflow.
- `⌘K` opens shortcuts dialog. `⌘I` toggles AI panel and focuses input when opening.
- Breadcrumb: click Home → PTY gets `cd ~\n`; click current segment → dropdown populated; click child → cd into it.
- Status bar right side: shows "Open AI Agent ⌘I" when closed, tools cluster when open.
- Submit prompt → session card appears above input; click card → new window opens.
- Narrow window (~600px): search collapses, tabs scroll, icons don't overlap.

## Defaults

- AI panel closed on launch (terminal-first).
- Resizable split default: terminal 65% / AI session 35% when first opened; persisted in-memory only.
- Motion: `prefers-reduced-motion` respected (disable enter/exit animations, keep state changes instant).
