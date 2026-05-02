<div align="center">
  <img src="public/logo.png" width="144" height="144" alt="Terax" />
  <h1>Terax</h1>

  <p><strong>Open-source lightweight cross-platform AI-native terminal (ADE)</strong></p>

  <p>
    <img src="https://img.shields.io/badge/version-0.5.6-blue" alt="version" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platform" />
  </p>
</div>

---

Terax is a fast, lightweight AI terminal (ADE) built on Tauri 2 + Rust and React 19. It pairs a native PTY backend with a modern UI — multi-tab terminals, an integrated code editor, a file explorer, and a first-class AI side-panel that works with your own API keys (or fully local models via LM Studio). Under 10 MB on disk, no telemetry, keys stored in the OS keychain.

## Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/terminal.png" alt="Terminal" /><br/><sub>Multi-tab terminal with WebGL rendering</sub></td>
    <td align="center"><img src="docs/editor.png" alt="Editor" /><br/><sub>CodeMirror 6 editor with AI autocomplete and Vim mode</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/ai-window.png" alt="AI window" /><br/><sub>BYOK AI assistant with tools, agents, and approval flow</sub></td>
  </tr>
</table>

## Features

**Terminal**
- xterm.js + WebGL renderer, multi-tab with background streaming
- Native PTY backend via `portable-pty` (zsh, bash, pwsh, …)
- Shell integration (cwd reporting, prompt markers) via injected init scripts
- Inline search, link detection, true-color

**Editor**
- CodeMirror 6 with language support for TS/JS, Rust, Python, HTML/CSS, JSON, Markdown
- Inline AI autocomplete and AI edit diffs
- Vim mode
- Prebuilt themes: Tokyo Night, Nord, GitHub, Atom One, Aura, Copilot, Xcode

**File Explorer**
- Catppuccin icon theme (Material Icon Theme resolver)
- Fuzzy search, keyboard navigation, inline rename, context actions

**Web Preview**
- Auto-detects local dev servers and opens them in a preview tab

**AI (BYOK)**
- Providers: OpenAI, Anthropic, Google, Groq, xAI, Cerebras, OpenAI-compatible
- Local / offline models via LM Studio
- Voice input, edit diffs, multi-agent and sub-agents
- Snippets / skills, customizable system prompt
- `TERAX.md` for project memory and configuration
- Tasks, plans, search, file read/write tools with approval flow

**Quality**
- Lightweight and fast (~7 MB bundle)
- API keys stored in the OS keychain (`tauri-plugin-keyring`) — never on disk
- No telemetry, no account required

## Configure AI

1. Open **Settings → AI**.
2. Pick a provider and paste your API key. For local inference, point Terax at your LM Studio endpoint.
3. Keys are written to the OS keychain via `tauri-plugin-keyring` — they never touch disk or `localStorage`.

## Build from source

**Prerequisites**
- Rust (stable) — https://rustup.rs
- Node 20+ and [pnpm](https://pnpm.io)
- Platform-specific Tauri prerequisites — https://tauri.app/start/prerequisites/

**Run**
```bash
pnpm install
pnpm tauri dev          # development
pnpm tauri build        # production bundle
```

**Checks**
```bash
pnpm exec tsc --noEmit          # frontend type-check
cd src-tauri && cargo clippy    # Rust lint
```

## Tech stack

Tauri 2 · Rust · `portable-pty` · React 19 · TypeScript · xterm.js · CodeMirror 6 · Vercel AI SDK v6 · Tailwind v4 · shadcn/ui · Zustand

## Project layout

```
src-tauri/        Rust backend — PTY, FS, shell, plugin wiring
src/
  modules/
    terminal/     xterm.js sessions + OSC handlers
    editor/       CodeMirror stack
    explorer/     File tree
    tabs/         Tab model (terminal | editor)
    ai/           Agent, sessions, tools, mini-window
    header/       Top bar, inline search
    statusbar/    Bottom bar
    shortcuts/    Keymap
  components/     shadcn/ui + AI Elements
```

## Contributing

Issues and PRs are welcome! Feel free to open issues, suggest features, or submit pull requests.

## License

Terax is licensed under the Apache-2.0 License. For more information on our dependencies, see [Apache License 2.0](LICENSE).
