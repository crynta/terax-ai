# Terminal clickable paths + local Whisper

**Date:** 2026-05-22
**Status:** Draft for implementation

Two independent features bundled into one spec because they're modest in size and share no code, only a release window:

1. Make file paths in terminal output clickable, opening the file in an in-app editor tab.
2. Add a local, in-browser Whisper transcription option so voice input no longer requires an OpenAI key.

The existing OpenAI cloud transcription path remains as a user-selectable provider.

---

## 1. Terminal clickable paths

### Goal

When `tsc`, `eslint`, `rustc`, `grep -n`, `ripgrep`, `pytest`, etc. print a file path — including `path:line:col` and bare filenames — clicking the path opens the file in a Terax editor tab (preview slot), with the cursor scrolled to `line:col` when present.

Critically: a path is underlined **only if it resolves to an existing file**, which kills the false-positive problem inherent to broad regex matchers.

### Architecture

Two link providers run side by side on each xterm instance:

- The existing `WebLinksAddon` keeps owning real URLs (`http(s)://…`, `file://…`).
- A new custom link provider, registered via `term.registerLinkProvider`, owns file paths.

The two domains don't overlap — `WebLinksAddon` regex requires a URL scheme; the file-path matcher rejects anything with `://`.

### Implementation outline

**New module: `src/modules/terminal/lib/fileLinkProvider.ts`.**

```
provideLinks(bufferLineNumber, callback):
  1. Read the line text from term.buffer.active.
  2. Tokenize candidates with a permissive regex covering:
       - absolute paths   ( /…, ~/…, C:\…)
       - relative paths   ( ./…, ../…, slash-containing, etc.)
       - bare filenames   ( foo.ts, README.md  — extension required)
     Each may be suffixed with :line  or  :line:col .
  3. Cheap-reject obvious non-files before any fs probe:
       - pure numbers (12.345), semver, hex hashes, timestamps
       - URLs (any token containing "://")
       - tokens longer than 512 chars
  4. Skip the line entirely if it's longer than 1024 chars; cap
     candidates at 32 per line.
  5. Resolve relative paths against the leaf's tracked cwd.
  6. Existence probe per resolved absolute path via a new Rust command
     `fs_exists`, gated by an LRU (see below).
  7. callback([{ range, text }, ...]) with only the verified paths.
```

**Existence cache.** A module-level LRU keyed by absolute path. Positive results live 30 s, negative 5 s, bounded at 4096 entries. Entries are invalidated on click failure (ENOENT) so a moved/deleted file stops underlining on next hover.

**Cwd source.** Each terminal leaf already emits `onCwd(cwd)` from the OSC 7 handler at `src/modules/terminal/lib/osc-handlers.ts:21`. The renderer pool needs the current cwd per slot to resolve relative paths; we extend the existing `SlotAdapter` interface (rather than passing it through every call site) with a `getCwd(leafId)` accessor. If a leaf never emits OSC 7 (uninstrumented shell), we resolve only absolute paths — no fallback guessing.

**Click handler.** `handler(event, text)` calls a new `SlotAdapter.openFile(absPath, line?, col?)`. The adapter is populated in `App.tsx`, where the existing `openFileTab` callback is in scope. Modifier keys are ignored in this iteration (deferred — see "Out of scope").

**Tab + editor changes.**

- `openFileTab(path, pin)` in `src/modules/tabs/lib/useTabs.ts:205` gains an optional 3rd argument: `selection?: { line: number; col?: number }`. Stored on the `EditorTab` as a `pendingSelection` field.
- `EditorPane` (CodeMirror) consumes `pendingSelection` in an effect: on mount or when it changes, it dispatches a CodeMirror transaction that sets the selection at the requested line/col, scrolls into view (centered), and then clears `pendingSelection` via a tab-store mutation. Clearing is essential — otherwise re-activating the tab much later would re-jump.

### Out of scope

- Cmd/Ctrl+click → "open in OS default app". One-line future extension (the link handler already receives the `event`).
- Highlighting paths inside `file://` URLs beyond what `WebLinksAddon` already does.
- Detecting paths in stack traces with unusual delimiters (`at Foo (path:line:col)` is matched by the regex; `at Foo @ path line 42` is not).

### Files touched

- **New:** `src/modules/terminal/lib/fileLinkProvider.ts`
- **Modified:** `src/modules/terminal/lib/rendererPool.ts` (load second provider; extend `SlotAdapter` with `getCwd` and `openFile`)
- **Modified:** `src/modules/terminal/TerminalStack.tsx` and `TerminalPane.tsx` (thread cwd through to renderer pool)
- **Modified:** `src/modules/tabs/lib/useTabs.ts` (`selection?` parameter on `openFileTab`; new `pendingSelection` field on `EditorTab`)
- **Modified:** `src/modules/editor/EditorPane.tsx` (consume `pendingSelection`)
- **Modified:** `src/app/App.tsx` (wire `getCwd`/`openFile` into `SlotAdapter`)
- **New (Rust):** `fs_exists` command in `src-tauri/src/modules/fs/file.rs`, registered in `src-tauri/src/lib.rs` alongside `fs_read_file` / `fs_canonicalize`. Signature follows the existing pattern: `fn fs_exists(path: String, workspace: Option<WorkspaceEnv>) -> Result<bool, String>`. Called from the link provider via `invoke<boolean>("fs_exists", { path })`. We follow the codebase's established custom-command pattern rather than introducing `@tauri-apps/plugin-fs` for a single call.
- **Tests:** unit tests for the matcher regex (positive/negative cases) and the existence-cache LRU. Integration test for `openFileTab` with `selection` is reasonable; click-event simulation through xterm is not worth it.

---

## 2. Local Whisper transcription

### Goal

Replace the hardcoded OpenAI Whisper dependency in `src/modules/ai/hooks/useWhisperRecording.ts` with a provider-selectable transcription layer. Default to a local in-browser model so voice input works out of the box for users without an OpenAI key.

### Architecture

**Library.** `@huggingface/transformers` (ESM, maintained successor to `@xenova/transformers`). Ships ONNX Runtime with WebGPU + WASM execution providers, auto-selects per platform.

WebGPU availability across Tauri platforms:

- **macOS** (WKWebView, Sonoma+): WebGPU available.
- **Windows** (WebView2 / Chromium): WebGPU available.
- **Linux** (WebKitGTK): no WebGPU — auto-falls-back to WASM (CPU, slower but works).

We do not surface this choice; we just show "Loaded (CPU)" vs "Loaded (GPU)" in settings status for the curious.

**Worker boundary.** Inference is heavy and must not block the UI. New file: `src/modules/ai/workers/whisperWorker.ts`, instantiated via Vite's recommended pattern: `new Worker(new URL("./whisperWorker.ts", import.meta.url), { type: "module" })`. A singleton pipeline lives inside the worker; once loaded it stays warm until the user changes model, unloads explicitly, or switches provider.

**Worker protocol.**

```ts
type In  = { kind: "load",       model: string }
        | { kind: "transcribe",  pcm: Float32Array, language?: string }
        | { kind: "unload" };

type Out = { kind: "progress",   file: string, loaded: number, total: number }
        | { kind: "ready",       model: string, backend: "gpu" | "cpu" }
        | { kind: "result",      text: string }
        | { kind: "error",       message: string };
```

`load` is idempotent. The HF library's progress callback is forwarded as `progress` events so the UI can show "Downloading… 43 MB / 140 MB". The PCM `Float32Array` is sent as a transferable to avoid copy overhead.

**Audio pipeline (main thread).**

```
mic getUserMedia                                  (unchanged)
  → MediaRecorder                                 (unchanged)
  → on stop: Blob
  → arrayBuffer → OfflineAudioContext.decodeAudioData
  → mono downmix (channel average)
  → resample to 16 kHz via OfflineAudioContext (16 000 Hz target rate)
  → Float32Array PCM
  → worker.postMessage({ kind: "transcribe", pcm }, [pcm.buffer])
  → worker.onmessage("result") → onResult(text)
```

The decode + resample step is ~50 ms for a 10 s clip and stays on the main thread. If profiling shows this hurts on low-end machines we can move it into the worker later — out of scope for v1.

**Transcriber abstraction.**

`useWhisperRecording.ts` is refactored so the transcription call is provider-agnostic:

```ts
interface Transcriber {
  transcribe(blob: Blob): Promise<string>;
  // optional: progress + state for the local one
  state?: "idle" | "loading" | "loaded" | "error";
  progress?: { file: string; loaded: number; total: number };
}
```

Two implementations:

- `openaiTranscriber({ apiKey })` — the current code at `useWhisperRecording.ts:21-28`, lifted into its own module.
- `localWhisperTranscriber({ model })` — owns the worker singleton, exposes `transcribe`, `state`, `progress`, `unload`. Decode/resample lives here, before posting to the worker.

The hook reads `voiceProvider` from `usePreferencesStore` and selects the implementation via a small factory. The hook's public API (start/stop/state) is unchanged for callers.

**Default model.** `onnx-community/whisper-base` (~140 MB quantized, multilingual). Rationale:

- `tiny` is noticeably worse on accents and disfluencies — not a good first-run impression.
- `small` is ~460 MB, rude as a default download.
- `base` is the sweet spot.

Selector in settings exposes: `tiny.en`, `base.en`, `base`, `small.en`, `small`. `.en` variants are English-only and meaningfully faster; we offer them but don't default to them (users speaking other languages would silently get gibberish).

**Lifecycle.**

- Worker is created lazily on first mic-click after Local is selected (not at app start — keeps cold start fast and respects users who never use voice).
- Recording and model-load run in parallel on first use. If the user finishes speaking before the model is ready, the UI shows "Transcribing (waiting for model)…" and resolves when both arrive. Implementation: `start()` fires `worker.load()` if not loaded; the `MediaRecorder.onstop` handler awaits a `whenReady` promise before posting PCM.
- "Unload" in settings sends `{ kind: "unload" }` and frees ~300 MB RAM. Provider switch and model switch both unload first.

### Settings UI

New panel section in `src/modules/settings`, header "Voice input":

```
Voice input
  Provider              ( ) OpenAI cloud
                        (•) Local (in-app)

  ── shown when "Local" ──
  Model                 [ whisper-base  ▾ ]   (tiny.en 75 MB · base.en 140 MB
                                                · base 140 MB · small.en 460 MB · small 460 MB)
  Language              [ Auto-detect   ▾ ]   (only for non-".en" models)
  Status                Loaded (GPU) · 138 MB cached    [Unload]   [Clear cache]

  ── shown when "OpenAI cloud" ──
  Uses OpenAI API key from AI settings.
  Model                 whisper-1                       (fixed)
```

**Preferences store additions** (`usePreferencesStore`, persisted via Tauri store plugin):

```ts
voiceProvider:        "openai" | "local"   // default: "local"
localWhisperModel:    WhisperModelId       // default: "onnx-community/whisper-base"
localWhisperLanguage: string | "auto"      // default: "auto"
```

### Mic button states

The existing button at `src/modules/ai/components/AiStatusBarControls.tsx:125-153` already has idle / recording / transcribing. Two new states:

- **loading-model** — first click after Local was selected, while model downloads + warms. Tooltip: "Downloading model… 43 MB / 140 MB". Clicking cancels the load and reverts to idle.
- **disabled-no-config** — Local picked but load errored, *or* OpenAI picked without a key. Tooltip explains and links to settings.

The current `!hasKey`-disabled gate is replaced by a provider-aware `canRecord` selector.

### Files touched

- **New:** `src/modules/ai/workers/whisperWorker.ts`
- **New:** `src/modules/ai/lib/transcribers/openai.ts`
- **New:** `src/modules/ai/lib/transcribers/local.ts`
- **New:** `src/modules/ai/lib/transcribers/index.ts` (factory + `Transcriber` interface)
- **New:** `src/modules/ai/lib/audio.ts` (Blob → 16 kHz mono PCM helpers)
- **Modified:** `src/modules/ai/hooks/useWhisperRecording.ts` (provider-agnostic)
- **Modified:** `src/modules/ai/components/AiStatusBarControls.tsx` (new states)
- **Modified:** `src/modules/ai/lib/AiInputBar.tsx` (download-progress status text)
- **Modified:** `src/modules/settings/preferences.ts` (new fields, defaults)
- **Modified:** the settings panel that holds AI settings (new "Voice input" section)
- **New dep:** `@huggingface/transformers`
- **Tests:** unit tests for the audio decode/resample helpers (deterministic given a known WAV input); a worker-protocol smoke test that mocks the pipeline; provider-switching test on the hook.

### Documentation follow-ups (not code)

- `README.md` and `docs/ai-workflow.png` mention voice input requires an OpenAI key — copy needs updating.
- Mention model first-run download in the README's voice-input section.

---

## 3. Error handling & edge cases

### Terminal

- **Existence-check races.** A file shown in the buffer can be deleted between cache fill and click. The click handler awaits `openFile(...)`; if it reports ENOENT, a transient toast in the terminal area says "File no longer exists" and the cache entry is invalidated so the next hover won't underline it. No retry.
- **Cwd loss.** Leaves that never emit OSC 7 (shell not instrumented) keep `lastCwd = null`. Only absolute paths get underlined. No falling back to the host app's cwd — that would silently open the wrong file in a multi-project session.
- **Perf ceiling.** Lines longer than 1024 chars are skipped wholesale; per-line candidate cap is 32; tokens longer than 512 chars are skipped. LRU cache is bounded at 4096 entries (positive 30 s, negative 5 s).
- **False-positive damping.** Before any fs probe, cheap regex rejects: pure numbers, semver, hex hashes (no slash + no extension + length ≥ 7), URLs (anything with `://`), timestamps.
- **Editor scroll-to-line consumption.** `pendingSelection` is cleared as soon as `EditorPane` applies it. Re-activating the tab months later must not re-jump.

### Whisper

- **Model load failure** (HF CDN unreachable, browser cache corrupted, OOM). Worker emits `{ kind: "error" }`. Hook surfaces an inline error in the composer status slot (same slot that today reads "Transcribing…") with a "Retry" button. No automatic cloud fallback — provider choice is explicit.
- **Decode failure.** Some Linux WebKitGTK builds reject certain MediaRecorder MIME types. Caught in the decode step; we drop the recording and show "Couldn't decode audio — try a different codec in settings." `MIME_CANDIDATES` is extended slightly to include WAV fallback where supported; everything else is unchanged.
- **Storage pressure.** Models live in the WebView's Cache Storage. "Clear cache" calls `caches.delete('transformers-cache')`. We don't manage quota — the browser does.
- **Empty / silent recording.** `blob.size === 0` shortcut from current code is kept. Additionally we early-return if the post-decode PCM is shorter than 200 ms — saves a worker round-trip on accidental taps.
- **Concurrency.** The explicit parallel path is recording-while-model-downloads (section 2 lifecycle). What's forbidden: starting a second recording while transcription is in flight — the mic button is `disabled` in the `transcribing` state, same as today.

---

## 4. Out of scope

Listed explicitly so the implementation plan doesn't quietly absorb these:

- **Streaming / real-time transcription.** The Whisper architecture supports it; this design is record-then-transcribe only.
- **Speaker diarization, timestamps, language auto-switching mid-clip.**
- **OpenAI-compatible base-URL config** for a third "self-hosted server" provider. Cheap to add but explicitly *not* what the user picked.
- **Per-leaf Cmd/Ctrl+click → "open in OS default app"** for terminal links.
- **Detecting paths inside `file://` URLs** beyond what `WebLinksAddon` already does.
- **Worker-side audio decode** (only matters if main-thread resample becomes a measurable problem).
- **Quota-aware model cache management.**

---

## 5. Testing strategy

**Unit / vitest:**

- File-link matcher regex: positive cases (`src/foo.ts`, `./bar.rs:42`, `/abs/x.py:10:5`, `README.md`) and negative cases (semver, hex hash, URL, plain number).
- Existence-cache LRU: insertion, eviction, positive/negative TTLs, invalidation on click failure.
- `openFileTab(path, pin, selection)` returns a tab with the right `pendingSelection`; same path called twice keeps the same tab id.
- Audio: known WAV blob → mono 16 kHz Float32 PCM with expected length / sample rate.
- Transcriber factory: returns local when provider is "local"; returns openai when "openai" with key; returns null + reason when "openai" without key.

**Manual / smoke:**

- Click a tsc-style `src/foo.ts:42:5` path in a real terminal session → file opens to that line.
- Click a deleted file's path → toast shown; underline gone on next render.
- First-run voice input with no OpenAI key, Local provider → model downloads with progress UI; transcription completes.
- Switch provider to OpenAI cloud → next voice input uses the cloud path.
- Unload model → status updates; next recording reloads.

---

## 6. Open questions

None blocking. Resolved during brainstorming:

- Matcher scope: broadest (bare filenames included), gated by existence check.
- Click target: in-app preview tab.
- Whisper backend: in-browser WASM/WebGPU via `@huggingface/transformers`.
- Cloud fallback: keep both, user-selectable, no silent fallback.
- Default provider: Local.
- Default model: `onnx-community/whisper-base`.
