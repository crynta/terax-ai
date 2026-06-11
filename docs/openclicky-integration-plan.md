# OpenClicky Integration Plan (v4 — Final)

Port all OpenClicky features into Terax. macOS-primary with native APIs via `objc2`, feature-gated behind Cargo feature for clean Linux/Windows builds. Modules distributed by domain, extending existing Terax infrastructure where possible.

Revised after:
- Full audit of terax-pi codebase (all Rust modules, all TS modules, lib.rs registration, Cargo.toml deps, tauri.conf.json)
- Full audit of openclicky codebase (93+ Swift files, CompanionManager 17K-line god object, 63 bundled skills, Codex integration, external control bridge, 5 Swift packages)
- Independent advisor review (module structure, cross-platform, TTS simplification, overlay redesign, MCP server placement, agent schema, effort estimation)
- Final validation pass (41 issues found and fixed: naming, deps, serde compat, skill scanner coupling, MCP type mapping, effort estimates, capability registration, feature gate completeness)

---

## 1. Audit Summary

### What Terax Already Has (Reuse, Don't Duplicate)

| Capability | Location | Notes |
|---|---|---|
| AI agent with streaming | `src/modules/ai/lib/agent.ts` | `streamText()` with 17 tools, 24 steps. Add new tools to `buildTools()` in `tools/tools.ts` |
| 13 model providers | `src/modules/ai/config.ts` | ProviderId type. TTS/STT providers get separate types (TtsProviderId, SttProviderId), not added to ProviderId |
| MCP client | `src-tauri/src/modules/mcp.rs` + `mcp/` | Full: stdio/HTTP, OAuth, tool discovery, approval, config, restart backoff. Extend for server mode |
| Voice recording | `src/modules/ai/hooks/useWhisperRecording.ts` | Browser MediaRecorder + Whisper-1. Refactor into provider-agnostic |
| Session persistence | `src/modules/ai/store/chatStore.ts` | Zustand + tauri-plugin-store. Extend for agent memory |
| Composer | `src/modules/ai/lib/composer.tsx` | Text, files, images, snippets, slash commands, voice. Extend for TTS |
| HTTP proxy (SSRF-safe) | `src-tauri/src/modules/net.rs` | `ai_http_request`, `ai_http_stream`. Reuse for Cartesia/Deepgram HTTP |
| Secret storage | `src-tauri/src/modules/secrets.rs` | OS keychain. Store TTS/Deepgram/Cartesia keys |
| Shell execution | `src-tauri/src/modules/shell/` | One-shot, persistent sessions, background processes |
| Agent detection | `src-tauri/src/modules/pty/agent_detect.rs` | OSC 133/777 parser for 7+ agents |
| Agent hooks | `src-tauri/src/modules/agent.rs` | Installs OSC markers into Claude/Codex/Gemini/Antigravity configs |
| Schedule system | `src-tauri/src/modules/schedule.rs` | Cron daemon (feature-gated `workflow`). Extend for automation model |
| Pi skills system | `src-tauri/src/modules/pi/skills.rs` | Scans SKILL.md files, frontmatter parsing, max 200 skills, 64KB limit. Core scanner logic to extract into shared `skill_scanner.rs` for reuse |
| Browser preview | `src-tauri/src/modules/browser.rs` | Native child webview (exists but not wired into lib.rs yet) |
| Capability/approval system | `src-tauri/src/modules/capabilities/` | Manifests, approval policies, audit logging |
| Artifact system | `src-tauri/src/modules/artifacts/` | AI-generated artifact CRUD, React preview compilation |
| Desktop notifications | `tauri-plugin-notification` | Already registered in lib.rs |

### What Terax Does NOT Have (OpenClicky Gap)

| Capability | Priority | OpenClicky Implementation |
|---|---|---|
| **TTS engine** | P0 | 3 providers (ElevenLabs, OpenAI Realtime, Deepgram Voice Agent). Streaming PCM |
| **Global push-to-talk hotkey** | P0 | CGEvent tap via `GlobalPushToTalkShortcutMonitor.swift` |
| **Alternate transcription** | P1 | 4 providers (Apple Speech, AssemblyAI, Deepgram, OpenAI Whisper) |
| **Local TTS (AVSpeechSynthesizer)** | P1 | Native macOS voices, no API key, offline |
| **Wake word** | P1 | Planned: Picovoice Porcupine via `OpenClickyWakeWordManager` |
| **On-disk agent definitions** | P1 | `OpenClickyAgentDefinition` with soul.md, instructions.md, memory.md |
| **Persistent agent memory** | P1 | `memory.md` with archive-first, max ~120KB, learned skills |
| **63 bundled skills** | P1 | SKILL.md files in `OpenClickyBundledSkills/` with frontmatter |
| **Screen capture** | P1 | `ScreenCaptureKit` via `CompanionScreenCaptureUtility` |
| **Cursor overlay** | P1 | `OverlayWindow` — primary cursor, secondary cursors, captions, response cards, agent dock |
| **Computer-use (CUA)** | P2 | `OpenClickyComputerUseRuntime` — CGEvent keyboard/mouse, `computer_20251124` beta tool |
| **External control bridge** | P2 | HTTP at `127.0.0.1:32123` — cursor, screenshot, speak, clear, events |
| **Agent Mode (Codex)** | P2 | `CodexAgentSession` spawns bundled Codex CLI with skills/memory/instructions |
| **MCP server** | P2 | HTTP bridge. Terax should use stdio `rmcp` instead |
| **Automations** | P2 | `OpenClickyAutomationStore` with 30s scheduler, cron intervals |
| **3D generation** | P3 | Tripo v2 API, SceneKit viewer, `/3d` slash command |
| **Menu-bar tray icon** | P2 | NSStatusItem, `LSUIElement=true`, dynamic status icons |
| **Annotation overlay** | P2 | Scribbles, rectangles, arrows via visual guidance models |
| **iOS companion** | P3 | Planned 6-phase. Out of scope for Terax |
| **SDK embedding** | P3 | `OpenClickySDKSession` for embedding in other apps. Terax is the host |
| **Element location detector** | P2 | `OpenClickyElementLocationDetector` — CGEvent-based UI element finding for CUA |
| **Mini chat overlay** | P3 | Floating mini chat window for quick agent queries without main window |
| **Log viewer** | P3 | `OpenClickyLogViewer` — debug log browser for troubleshooting |
| **Prompt autocomplete** | P2 | `OpenClickyPromptAutocomplete` — slash command + context-aware suggestions in composer |

---

## 2. Architecture

### Rust Module Map (Domain-Based, Feature-Gated)

```
src-tauri/src/modules/
  EXISTING (unchanged):
    pty/  fs/  git/  net/  mcp/  shell/  secrets/  workspace/
    artifacts/  capabilities/  agent.rs  model_compare.rs  schedule.rs  ...

  NEW or EXTENDED:
    voice/                          [NEW, feature-gated on macOS parts]
      mod.rs                        Module root + Tauri command registration
      tts/
        mod.rs                      TtsProvider trait + TtsManager
        cartesia.rs                 Cartesia HTTP TTS (all platforms, reqwest)
        avspeech.rs                 AVSpeechSynthesizer (macOS only, objc2/avaudio)
        queue.rs                    tokio mpsc playback serialization
      transcription/
        mod.rs                      TranscriberProvider trait
        deepgram.rs                 Deepgram streaming STT (all platforms)
        speech.rs                   SFSpeechRecognizer (macOS only, feature-gated)
      wake_word/
        mod.rs                      Wake word detector (macOS only, feature-gated)
      commands.rs                   tts_speak, tts_stop, tts_status, transcribe_audio, transcribe_local

    capture/                        [NEW]
      mod.rs
      screenshot.rs                 Cross-platform: macOS ScreenCaptureKit / Linux portal / Windows GraphicsCapture
      window_enum.rs                CGWindowListCopyWindowInfo (macOS only, feature-gated)
      commands.rs                   capture_screen, list_windows

    overlay/                        [NEW, macOS feature-gated]
      mod.rs
      manager.rs                    Overlay window lifecycle (WebviewWindow + transparency shim)
      transparency.rs               objc2 WKWebView transparency (setOpaque, clearColor)
      drawing.rs                    Annotation command dispatch
      commands.rs                   overlay_show, overlay_hide, overlay_draw, overlay_clear

    agents/                         [NEW, all platforms]
      mod.rs
      definition.rs                 Terax Agent Schema (JSON), load/save/validate/list
      store.rs                      Two-root registry (bundled readonly + user override)
      memory.rs                     Persistent memory with archival (extends session store)
      lease.rs                      FileLeaseCoordinator (Arc<RwLock<HashMap>>)
      migrator.rs                   One-time import from OpenClicky markdown format
      commands.rs                   agent_list, agent_load, agent_save, agent_delete, memory_read, memory_append

    skills/                         [EXTENDS pi/skills.rs pattern]
      mod.rs
      loader.rs                     SKILL.md scanner (reuse pi/skills.rs logic)
      bundled.rs                    Default skills shipped in app resources
      commands.rs                   skill_list, skill_status

    mcp/                            [EXTENDS existing module]
      server.rs                     [NEW] rmcp stdio MCP server + tool registry trait
      server_tools.rs               [NEW] Tool definitions (screenshot, speak, annotate, etc.)
      cli.rs                        [NEW] --mcp-server flag handler
      mod.rs                        [EXTEND] re-export server

    schedule.rs                     [EXTEND existing]
      Add Automation struct (prompt + agent_slug), persistence, React trigger

    tray.rs                         [NEW, macOS feature-gated]
      Tray icon setup, dynamic status icons, click handler

  src-tauri/src/modules/mod.rs      [EXTEND] add voice, capture, overlay, agents, skills, tray
  src-tauri/src/lib.rs              [EXTEND] register new states + invoke handlers
```

### Frontend Module Map

```
src/modules/
  ai/
    hooks/
      useWhisperRecording.ts        [REFACTOR] extract provider interface, keep MediaRecorder capture
      useTts.ts                      [NEW] speak, stop, isSpeaking, provider
      useTranscriber.ts              [NEW] provider switcher (whisper | deepgram | local)
      usePushToTalk.ts               [NEW] global hotkey bridge
    components/
      TtsButton.tsx                  [NEW] speaker icon on AI messages
      VoiceSettings.tsx              [NEW] provider selection, wake word toggle
    tools/
      tools.ts                       [EXTEND] add annotate + screen tools
      annotate.ts                    [NEW] AI tool: overlay annotations
      screen.ts                      [NEW] AI tool: capture screenshot
    agents/
      registry.ts                    [EXTEND] dynamic on-disk agent loader
    lib/
      agentArchive.ts                [NEW] conversation compaction
      platformCapabilities.ts        [NEW] feature flags for non-macOS
    config.ts                        [EXTEND] add Cartesia + Deepgram providers
  capture/
    useScreenCapture.ts              [NEW] hook for screenshot + window enum
  overlay/
    AnnotationOverlay.tsx            [NEW] renders annotations in overlay webview
  agents/
    AgentManager.tsx                 [NEW] agent picker + memory viewer
    SkillBrowser.tsx                 [NEW] browse + enable/disable skills
  scheduler/
    AutomationPanel.tsx              [NEW] cron/interval editor + run history
  settings/
    PermissionsSetup.tsx             [NEW] guided macOS permission setup
```

---

## 3. Feature Gate Strategy

### Cargo.toml

```toml
[features]
default = []
workflow = ["dep:cron", "dep:chrono", "dep:uuid"]
openclicky = [
    "dep:objc2", "dep:objc2-app-kit", "dep:objc2-av-foundation", "dep:objc2-foundation",
    "dep:avaudio", "dep:rodio", "dep:rmcp", "dep:tauri-plugin-global-shortcut",
    "tauri/tray-icon", "tauri/image-png",
]

[target.'cfg(all(target_os = "macos", feature = "openclicky"))'.dependencies]
objc2 = "0.6"
objc2-app-kit = { version = "0.3", features = ["NSWindow", "NSPanel", "NSStatusBarButton"] }
objc2-av-foundation = { version = "0.3", features = ["AVSpeechSynthesizer", "AVAudioEngine"] }
objc2-foundation = "0.3"
avaudio = "0.2"  # Validate at publish; fallback to raw objc2 if unavailable

[dependencies]
rodio = { version = "0.19", optional = true }
rmcp = { version = "1.7", optional = true }
tauri-plugin-global-shortcut = { version = "2", optional = true }
assert_cmd = "2"  # dev-dep for MCP server integration tests
```

Notes:
- `rmcp` and `tauri-plugin-global-shortcut` are optional to avoid binary bloat (TERAX.md: "Unused features consume zero resources")
- `objc2-app-kit` and `objc2-av-foundation` need explicit feature flags for NSWindow, AVSpeechSynthesizer etc.
- `avaudio` 0.2 is pre-1.0; validate it provides AVSpeechSynthesizer or fall back to raw objc2 calls
- Cartesia/Deepgram API keys use existing `secrets_*` with separate keyring accounts (`cartesia-api-key`, `deepgram-api-key`)

### lib.rs Registration

```rust
// src-tauri/src/lib.rs additions

// Line 18-20: add to use import
use modules::{
    agent, artifacts, capture, fs, git, mcp, model_compare, net,
    overlay, pi, pty, secrets, shell, skills, tray, voice, workspace,
    agents,
};

// .plugin() chain — add after existing plugins:
.plugin(tauri_plugin_global_shortcut::init())

// .manage() chain — add after line 202:
.manage(voice::VoiceState::default())
.manage(capture::CaptureState::default())
.manage(agents::AgentRegistry::default())
.manage(skills::SkillsState::default())

// .invoke_handler — add all new commands from voice, capture, overlay, agents, skills, tray
```

### capabilities/default.json

```json
{
  "permissions": [
    "global-shortcut:default"
  ]
}
```

### Info.plist

```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>Terax uses speech recognition to transcribe your voice input.</string>
<key>NSScreenCaptureUsageDescription</key>
<string>Terax can capture your screen to provide visual context to the AI.</string>
```

### TypeScript

```typescript
// src/lib/platformCapabilities.ts
export const caps = {
  nativeTts: navigator.userAgent.includes("Mac"),
  localStt: navigator.userAgent.includes("Mac"),
  wakeWord: navigator.userAgent.includes("Mac"),
  overlay: navigator.userAgent.includes("Mac"),
  tray: navigator.userAgent.includes("Mac"),
  screenCapture: true,
};
```

TTS/STT providers use **separate** types from LLM ProviderId:

```typescript
type TtsProviderId = "cartesia" | "avspeech";    // NOT in ProviderId union
type SttProviderId = "whisper" | "deepgram" | "local";  // NOT in ProviderId union
```

Settings UI checks `caps` flags. Non-macOS: only cloud providers shown. Wake word/overlay/tray sections hidden.

New preference keys (extend `src/modules/settings/store.ts`):

```typescript
ttsProvider: TtsProviderId;
sttProvider: SttProviderId;
wakeWordEnabled: boolean;
pushToTalkShortcut: string;
overlayEnabled: boolean;
```

---

## 4. Permissions Strategy (macOS)

### Required

| Permission | Trigger | Info.plist Key |
|---|---|---|
| Microphone | Voice input, wake word | `NSMicrophoneUsageDescription` (already present) |
| Speech Recognition | Local STT | `NSSpeechRecognitionUsageDescription` (NEW) |
| Screen Recording | Screenshot capture | `NSScreenCaptureUsageDescription` (NEW) |
| Accessibility | Global hotkey, window enum | (TCC, no Info.plist key) |

### Entitlements

```xml
<key>com.apple.security.device.audio-input</key><true/>
```

### Flow

1. Never prompt all at once. Prompt when each feature is first used
2. `PermissionsSetup.tsx` available in Settings with deep links to System Settings
3. Rust checks TCC status before attempting. Graceful fallback if denied
4. `macos-private-api` for transparent overlay requires hardened runtime entitlements
5. Notarization requires all entitlements declared in the hardened runtime profile

---

## 5. Phase 0: Spike — Validate High-Risk Items (1 week)

Before committing, validate the three highest-risk items:

### 0a: Tray Icon

Test `ActivationPolicy::Accessory` on macOS 14/15:
- Set in `main()` before Tauri via `objc2`
- Register `TrayIconBuilder` in `setup()`
- Test from `.app` bundle (not `cargo run`)
- Test deep link doesn't reset policy
- **Fallback:** Accept Dock icon, tray as secondary status indicator only

### 0b: Overlay Transparency

Test fullscreen transparent WKWebView:
- `WebviewWindowBuilder` with `transparent(true)` + `decorations(false)` + `always_on_top(true)`
- Apply objc2 transparency shim
- Test: no flicker on space switch, no GPU drain at 5K, cursor events work
- **Fallback:** Regular Tauri window with semi-transparent background

### 0c: ScreenCaptureKit

Test `tauri-plugin-screen-capture` permission flow on macOS 14/15.

**Go/no-go:** All three pass basic smoke tests before proceeding to Phase 1.

---

## 6. Phase 1: TTS Engine (P0)

### Design

Stream LLM tokens -> detect sentence boundaries in TypeScript -> invoke `tts_speak` per sentence -> Rust dispatches to provider -> serialized playback queue.

**No filler phrases.** Single playback path through `rodio` (Cartesia) or `avaudio` (AVSpeechSynthesizer handles its own playback).

### Providers

| Provider | Type | Playback | Auth | Platform |
|---|---|---|---|---|
| Cartesia | Cloud | HTTP -> PCM -> `rodio` | API key in keyring | All |
| AVSpeechSynthesizer | Local | Native via `avaudio` | None | macOS |

### Sentence Boundary (TypeScript)

```typescript
function splitSentences(text: string): string[] {
  return text.match(/[^.!?]*[.!?]+[\s"]*/g) ?? [text];
}
```

Called in `useTts` hook. Each sentence -> `invoke('tts_speak', { text, provider })`.

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/voice/tts/mod.rs` | TtsProvider trait, TtsManager, TtsState |
| `src-tauri/src/modules/voice/tts/cartesia.rs` | Cartesia HTTP -> PCM bytes |
| `src-tauri/src/modules/voice/tts/avspeech.rs` | AVSpeechSynthesizer (feature-gated) |
| `src-tauri/src/modules/voice/tts/queue.rs` | tokio mpsc playback serialization |
| `src-tauri/src/modules/voice/commands.rs` | tts_speak, tts_stop, tts_status |
| `src-tauri/src/modules/voice/mod.rs` | Module root |
| `src/modules/ai/hooks/useTts.ts` | React hook |
| `src/modules/ai/components/TtsButton.tsx` | Speaker icon on AI messages |

### Integration Points

- `src-tauri/src/lib.rs:185-202` — add `voice::TtsState::default()` to `.manage()`
- `src-tauri/src/lib.rs:203-348` — add `voice::commands::*` to `invoke_handler`
- `src-tauri/src/modules/mod.rs` — add `pub mod voice;`
- `src/modules/ai/config.ts` — add `cartesia` to SEPARATE `TtsProviderId` type (not `ProviderId`)
- `src/modules/ai/components/AiChatMessage.tsx` — add TTS button per message

---

## 7. Phase 2: Voice Enhancements (P0-P1)

### 2a: Global Push-to-Talk

```
tauri-plugin-global-shortcut
  -> registers Cmd+Opt+Space (configurable)
  -> on press: emit 'voice-ptt-start' to webview
  -> on release: emit 'voice-ptt-stop'
  -> webview: uses existing useWhisperRecording (MediaRecorder)
  -> transcribes with selected provider
  -> injects into composer
```

No Rust-side audio capture for PTT. Reuses browser MediaRecorder. Global shortcut just triggers the existing pipeline when unfocused.

### 2b: Alternate Transcription Providers

| Provider | Type | Auth | Platform |
|---|---|---|---|
| OpenAI Whisper-1 | Cloud | Existing key | All |
| Deepgram | Cloud | API key | All |
| SFSpeechRecognizer | Local | None | macOS |

Keep MediaRecorder capture. Swap POST endpoint:

```typescript
type TranscriberProvider = "whisper" | "deepgram" | "local";
```

`useTranscriber.ts` wraps `useWhisperRecording` with provider switching. SFSpeechRecognizer via Rust command (macOS only).

### 2c: Wake Word (macOS, Feature-Gated)

AVAudioEngine mic capture -> VAD -> wake word model -> emit event to webview. Only active when user enables in settings.

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/voice/transcription/mod.rs` | TranscriberProvider trait |
| `src-tauri/src/modules/voice/transcription/deepgram.rs` | Deepgram HTTP streaming |
| `src-tauri/src/modules/voice/transcription/speech.rs` | SFSpeechRecognizer (feature-gated) |
| `src-tauri/src/modules/voice/wake_word/mod.rs` | Wake word detector (feature-gated) |
| `src-tauri/src/modules/voice/commands.rs` | Extend: transcribe_local |
| `src/modules/ai/hooks/useTranscriber.ts` | Provider switcher |
| `src/modules/ai/hooks/usePushToTalk.ts` | Global hotkey bridge |
| `src/modules/ai/components/VoiceSettings.tsx` | Provider selection UI |
| `src/modules/ai/hooks/useWhisperRecording.ts` | Refactor: extract provider interface |

---

## 8. Phase 3: Specialist Agents + Skills + Memory (P1)

### 3a: Terax Agent Schema (JSON)

NOT OpenClicky's markdown format. Native JSON schema with one-time migrator.

**Naming:** `src-tauri/src/modules/agents/` (plural) is a NEW directory module for specialist agent definitions. This coexists with `src-tauri/src/modules/agent.rs` (singular, existing OSC marker hooks). Rust permits both because the module names differ (`agents` vs `agent`). Both registered in `mod.rs` as `pub mod agent;` and `pub mod agents;`.

```json
{
  "schemaVersion": 1,
  "slug": "code-reviewer",
  "displayName": "Code Reviewer",
  "description": "Reviews code for bugs, style, and performance",
  "accentColorHex": "#60A5FA",
  "systemPrompt": "You are an expert code reviewer...",
  "toolWhitelist": ["read_file", "fs_grep", "fs_search", "list_directory"],
  "memory": "",
  "skills": ["github-code-review"],
  "createdAt": "2026-06-10T00:00:00Z",
  "updatedAt": "2026-06-10T00:00:00Z"
}
```

Path: `~/.config/terax/agents/<slug>.json`. Bundled agents in app resources (read-only).

### 3b: OpenClicky Migrator

One-time import: reads `agent.json` + `soul.md` + `instructions.md` + `memory.md` + `skills.json` -> writes Terax JSON. `systemPrompt` = concatenated `soul.md + instructions.md`.

### 3c: Map to Terax Sub-Agent System

Each agent definition becomes a dynamically loaded sub-agent in `src/modules/ai/agents/registry.ts`. The existing `SUBAGENTS` map gets extended with on-disk agents loaded via `invoke('agent_load', { slug })`.

### 3d: Skills (Extract Shared Scanner from pi/skills.rs)

Terax has a skill scanner in `src-tauri/src/modules/pi/skills.rs` but it is `pub(super)` scoped and tightly coupled to `PiState`. Cannot reuse directly.

**Solution:** Extract a shared scanner utility:

```rust
// src-tauri/src/modules/skills/scanner.rs (new shared utility)
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub content: String,
}

pub fn scan_skill_dir(dir: &Path, max_skills: usize, max_bytes: usize) -> Result<Vec<SkillMeta>> {
    // Extracted from pi/skills.rs, made public, decoupled from PiState
}
```

Then `pi/skills.rs` calls `skills::scanner::scan_skill_dir()` instead of its own implementation. New `skills/` module uses the same function for bundled skills.

Bundled skills: copy from OpenClicky's `OpenClickyBundledSkills/` -> Terax app resources. Each skill is a directory with `SKILL.md`.

### 3e: Persistent Memory

Agent `memory` field in JSON. Append-only with archival:

```rust
const MAX_MEMORY_CHARS: usize = 120_000;
fn append_memory(slug: &str, user_request: &str, agent_response: &str) -> Result<()>;
fn archive_if_needed(slug: &str) -> Result<()>;
```

Archive written to `~/.config/terax/agents/<slug>.archive.jsonl`. Never delete.

### 3f: File Lease Coordinator

```rust
pub struct FileLeaseCoordinator {
    leases: Arc<RwLock<HashMap<PathBuf, Lease>>>,
}
```

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/agents/definition.rs` | AgentDefinition struct, load/save/list |
| `src-tauri/src/modules/agents/store.rs` | Two-root registry |
| `src-tauri/src/modules/agents/memory.rs` | Memory append + archival |
| `src-tauri/src/modules/agents/lease.rs` | FileLeaseCoordinator |
| `src-tauri/src/modules/agents/migrator.rs` | OpenClicky format import |
| `src-tauri/src/modules/agents/commands.rs` | Tauri commands |
| `src-tauri/src/modules/agents/mod.rs` | Module root |
| `src-tauri/src/modules/skills/scanner.rs` | Shared scanner extracted from pi/skills.rs |
| `src-tauri/src/modules/skills/loader.rs` | Load skills using shared scanner |
| `src-tauri/src/modules/skills/bundled.rs` | Default skills from app resources |
| `src-tauri/src/modules/skills/commands.rs` | skill_list, skill_status |
| `src-tauri/src/modules/skills/mod.rs` | Module root |
| `src/modules/ai/agents/registry.ts` | Extend with dynamic loader |
| `src/modules/agents/AgentManager.tsx` | Agent picker + memory viewer |
| `src/modules/agents/SkillBrowser.tsx` | Skill browser |

### Integration Points

- `src-tauri/src/modules/mod.rs` — add `pub mod agents; pub mod skills;`
- `src-tauri/src/lib.rs` — add states + invoke handlers
- `src/modules/ai/agents/registry.ts` — extend `SUBAGENTS` with dynamic agents
- `src/modules/ai/agents/runSubagent.ts` — accept dynamic agent slug
- `src-tauri/src/modules/pi/skills.rs` — refactor to call `skills::scanner::scan_skill_dir()` (reduce coupling)

---

## 9. Phase 4: Screen Capture + Annotation Overlay (P1-P2)

### 4a: Screenshot

```rust
#[tauri::command]
pub async fn capture_screen(focused_only: bool) -> Result<ScreenshotResult, String> {
    #[cfg(target_os = "macos")] { /* ScreenCaptureKit */ }
    #[cfg(target_os = "linux")]  { /* xdg-desktop-portal */ }
    #[cfg(target_os = "windows")] { /* GraphicsCapture API */ }
}
```

Returns JPEG. Composer attaches as image part (already supported).

### 4b: Window Enumeration (macOS)

```rust
#[cfg(feature = "openclicky")]
pub fn list_windows() -> Vec<WindowInfo> { /* CGWindowListCopyWindowInfo */ }
```

### 4c: Annotation Overlay

**Primary (if Phase 0 passes):** Transparent NSWindow + CoreGraphics drawing. No Canvas2D, no WKWebView for the drawing surface.

**Fallback:** Regular Tauri window with semi-transparent background.

```rust
#[tauri::command]
pub async fn overlay_draw(items: Vec<AnnotationItem>) -> Result<(), String>;
#[tauri::command]
pub async fn overlay_clear() -> Result<(), String>;
```

AI tool in `src/modules/ai/tools/annotate.ts`. Supports rect, arrow, text, circle, scribble.

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/capture/screenshot.rs` | Cross-platform screenshot |
| `src-tauri/src/modules/capture/window_enum.rs` | Window list (macOS) |
| `src-tauri/src/modules/capture/commands.rs` | capture_screen, list_windows |
| `src-tauri/src/modules/capture/mod.rs` | Module root |
| `src-tauri/src/modules/overlay/manager.rs` | Overlay lifecycle |
| `src-tauri/src/modules/overlay/transparency.rs` | objc2 WKWebView shim (macOS) |
| `src-tauri/src/modules/overlay/drawing.rs` | Annotation dispatch |
| `src-tauri/src/modules/overlay/commands.rs` | overlay_show/hide/draw/clear |
| `src-tauri/src/modules/overlay/mod.rs` | Module root |
| `src/modules/ai/tools/annotate.ts` | AI tool |
| `src/modules/ai/tools/screen.ts` | AI tool |
| `src/modules/overlay/AnnotationOverlay.tsx` | React component |

---

## 10. Phase 5: MCP Server via rmcp (P2)

Extends existing `src-tauri/src/modules/mcp/` module. Tool registry trait so modules expose capabilities without coupling.

### Tool Registry Trait

```rust
pub trait McpToolProvider: Send + Sync {
    fn tools(&self) -> Vec<rmcp::Tool>;
    fn call(&self, name: &str, params: Value) -> Result<Value, McpError>;
}
```

Each module (capture, voice/tts, shell, fs, git) implements this. Server iterates all registered providers.

### Type Compatibility Note

Terax's existing `mcp/types.rs` defines `McpTool`, `McpToolCall`, etc. The `rmcp` crate has its own `rmcp::model::Tool`, `rmcp::model::CallToolRequestParam`. These are NOT the same types.

**Strategy:** The MCP server uses `rmcp` types exclusively. The existing MCP client continues using its own types. A thin adapter in `server_tools.rs` maps between them:

```rust
fn from_terax_tool(tool: &crate::modules::mcp::types::McpTool) -> rmcp::model::Tool { ... }
```

No shared types between client and server. Clean separation.

### Transport

1. **Stdio (primary):** `terax --mcp-server` flag. `rmcp::transport::stdio()`. Auto-register in `.mcp.json`
2. **HTTP (optional):** Configurable localhost port. Replaces OpenClicky's `:32123` bridge

### Exposed Tools

| Tool | Source Module | Description |
|---|---|---|
| `screenshot` | capture | Capture screen + return image |
| `annotate` | overlay | Draw annotations |
| `speak` | voice/tts | TTS output |
| `notify` | notification | Desktop notification |
| `run_command` | shell | Shell command via PTY |
| `read_file` | fs | File contents |
| `list_directory` | fs | Directory listing |
| `git_status` | git | Working tree status |

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/mcp/server.rs` | ServerHandler impl via rmcp |
| `src-tauri/src/modules/mcp/server_tools.rs` | McpToolProvider trait + tool definitions |
| `src-tauri/src/modules/mcp/cli.rs` | `--mcp-server` flag handler |

### Integration Points

- `src-tauri/src/modules/mcp/mod.rs` — add `pub mod server; pub mod server_tools; pub mod cli;`
- `src-tauri/src/main.rs` or `src-tauri/src/bin/` — handle `--mcp-server` CLI flag
- Existing `mcp.rs` McpState stays as client state. Server state is separate.

---

## 11. Phase 6: Automations (P2)

Extend existing `src-tauri/src/modules/schedule.rs` (already has cron daemon behind `workflow` feature).

**Prerequisite:** `schedule.rs` is registered in `mod.rs` behind `#[cfg(feature = "workflow")]` but `ScheduleState` is NOT in `.manage()` in `lib.rs` and schedule commands are NOT in `invoke_handler`. This means the cron daemon exists but is not wired to the running binary. Must add `ScheduleState::default()` to `.manage()` and all schedule commands to `invoke_handler` (behind `#[cfg(feature = "workflow")]`) before extending with automations.

### Changes to ScheduleJob

```rust
pub struct ScheduleJob {
    pub id: String,
    pub name: String,
    pub cron_expression: String,
    pub enabled: bool,
    // NEW:
    pub prompt: Option<String>,        // AI prompt to run on trigger
    pub agent_slug: Option<String>,    // Which agent to use
    pub last_run: Option<String>,      // ISO 8601
    pub next_run: Option<String>,      // ISO 8601
}
```

Frontend receives `workflow:schedule` event (already emitted). New: if job has `prompt`, send to AI agent instead of just notifying.

### Persistence

Jobs persisted to `~/.config/terax/schedules.json` via tauri-plugin-store.

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/schedule.rs` | Extend ScheduleJob + persistence |
| `src/modules/scheduler/AutomationPanel.tsx` | Cron editor + agent picker + run history |

---

## 12. Phase 7: Conversation Archive + Compaction (P2)

Extend existing session store (`src/modules/ai/store/chatStore.ts`) with compaction.

```typescript
// src/modules/ai/lib/agentArchive.ts
const MAX_ACTIVE_PAIRS = 8;
const MAX_ARCHIVE_CHARS = 2400;

function compactIfNeeded(messages: UIMessage[]): { active: UIMessage[], archive: string } {
  // Keep last N pairs, compact rest into summary string
}
```

Works with existing `src/modules/ai/lib/compact.ts` (already has message compaction). Add archival persistence.

---

## 13. Phase 8: Menu-Bar Tray Icon (P2)

Feature-gated to macOS. Uses Tauri's `tray-icon` feature + `objc2` for `ActivationPolicy::Accessory`.

**Known risk:** Tauri 2 bugs with ActivationPolicy. Phase 0 spike validates.

**Fallback:** Accept Dock icon. Tray as secondary status indicator only (shows idle/thinking/speaking icons).

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/tray/mod.rs` | Tray icon setup (feature-gated) |
| `src-tauri/icons/tray.png` | Default icon |
| `src-tauri/icons/thinking.png` | Thinking status |
| `src-tauri/icons/speaking.png` | Speaking status |

### Integration Points

- `src-tauri/src/lib.rs:164` — setup closure, register tray after plugins
- `src-tauri/Cargo.toml` — `tauri = { features = ["tray-icon", "image-png"] }` (behind `openclicky` feature)

---

## 14. Phase 9: 3D Generation (P3)

Port OpenClicky's `ThreeDGenerationDispatcher`. Parse `/3d <prompt>` slash command. HTTP to Tripo v2 API. Render GLB in Terax tab using Three.js.

### Files

| File | Purpose |
|---|---|
| `src-tauri/src/modules/capture/three_d.rs` | Tripo API client |
| `src/modules/ai/lib/slashCommands.ts` | Extend: `/3d` command |

---

## 15. Drop from OpenClicky (Not Porting)

- Pet sprites / hatch system
- Onboarding video + music
- Notch capture window / Dynamic Notch Kit bridge
- SDK embedding (`OpenClickySDKSession`) — Terax is the app
- Per-screen bezier cursor flight (annotation overlay handles pointing)
- Filler phrase library (show tray status instead)
- OpenClicky's exact markdown agent format (use JSON schema + migrator)
- iOS companion app (out of scope)
- BackgroundComputerUse.app subprocess (Terax's shell module covers this)
- Picovoice Porcupine wake word (requires commercial license; use open-source alternative or skip)
- OpenClickyExternalControlBridge HTTP port (replaced by MCP server stdio)
- Mini chat overlay (Terax main window serves this purpose)
- Log viewer (use existing terminal + structured logging)
- Prompt autocomplete (defer to future iteration; existing slash commands cover basics)
- Element location detector (coupled to CUA which is P2+; revisit when implementing computer-use)

---

## 17. Effort Summary (Revised)

| Phase | Description | Rust LOC | TS LOC | Time |
|---|---|---|---|---|
| **0** | **Spike: tray + overlay + capture** | 200 | 50 | **1 week** |
| 1 | TTS Engine (Cartesia + AVSpeech) | 400 | 120 | 1 week |
| 2 | Voice Enhancements (PTT, Deepgram, SFSpeech) | 400 | 200 | 1.5 weeks |
| 3 | Specialist Agents + Skills + Memory | 1100 | 250 | 2.5 weeks |
| 4 | Screen Capture + Annotation Overlay | 400 | 80 | 1 week |
| 5 | MCP Server (rmcp stdio) | 500 | 0 | 1.5 weeks |
| 6 | Automations (wire schedule.rs + extend) | 300 | 200 | 1.5 weeks |
| 7 | Conversation Archive | 100 | 100 | 3 days |
| 8 | Menu-Bar Tray Icon | 100 | 0 | 3 days |
| 9 | 3D Generation | 150 | 80 | 2 days |
| | **Total** | **~3650** | **~1080** | **~11 weeks** |

Notes on revised estimates:
- Phase 3 increased by 100 LOC for skills scanner extraction + pi/skills.rs refactor
- Phase 5 increased by 100 LOC for rmcp type adapter layer
- Phase 6 increased: first wire schedule.rs into lib.rs (prerequisite), then extend
- Phase 8 increased: tray icon now under modules/ (proper module structure)

Buffer for permissions debugging, notarization, cross-platform testing, CI: **+2-4 weeks**.

**Realistic total: 13-15 weeks.**

---

## 18. Verification

Each phase must pass before the next begins:

```sh
# Frontend
pnpm exec tsc --noEmit
pnpm test

# Rust (with openclicky feature)
cd src-tauri && cargo clippy --all-targets --features openclicky -- -D warnings
cd src-tauri && cargo test --locked --features openclicky

# Rust (without openclicky, verify clean build on non-macOS)
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test --locked
```

New capabilities need:
- Rust integration tests for MCP server (spawn `--mcp-server`, send JSON-RPC over stdin, assert response)
- Rust unit tests for TTS queue, memory archival, agent schema validation, skill scanning
- React component tests for TTS button, voice settings, agent switcher
- `#[cfg(target_os = "macos")]` on all overlay/AVSpeech code
- Non-macOS CI: `cargo check` passes without `openclicky` feature
- macOS CI: full test suite with `openclicky` feature (except permission-requiring tests)
- CSP check: `tauri.conf.json` `security.dangerousDisableAssetCModification` or explicit `connect-src` for `api.cartesia.ai`, `api.deepgram.com`
- Verify `tauri-plugin-global-shortcut` capability registered in `.tauri/schemas/*.json`

---

## 19. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Tray icon ActivationPolicy instability (tauri#15005, #12128) | High | Medium | Phase 0 spike. Accept Dock icon as fallback |
| 2 | Annotation overlay flicker on WKWebView transparent | High | Medium | Use CoreGraphics. Fall back to regular window |
| 3 | macOS permission fatigue (4+ dialogs) | High | High | Prompt per-feature, guided setup, graceful fallback |
| 4 | `avaudio`/`objc2` crate maturity | Medium | Medium | Pin versions. Test on macOS 14 + 15. Raw objc2 fallback |
| 5 | `rmcp` compatibility with existing MCP client | Low | Medium | Server is separate code path. Same protocol version |
| 6 | 63 skills porting effort | Medium | Medium | Port top 20 first. Community contributes rest |
| 7 | Cartesia API rate limits | Low | Low | `rodio` playback is generic. Swap provider |
| 8 | `schedule.rs` extension conflicts with existing `workflow` feature | Low | Low | Automations are additive fields on ScheduleJob |
| 9 | `schedule.rs` not wired in lib.rs (no `.manage()`, no invoke handlers) | Low | High | Must fix before Phase 6. Add ScheduleState + commands behind `workflow` feature |
| 10 | `rmcp` crate version mismatch or breaking API changes | Medium | Medium | Pin exact version in Cargo.toml. Integration tests validate protocol compliance |
| 11 | CSP policy blocks Cartesia/Deepgram streaming requests | Medium | Medium | Add `connect-src` entries for `api.cartesia.ai` and `api.deepgram.com` in tauri.conf.json |
