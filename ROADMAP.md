# Roadmap

Terax direction, what's shipped, what's coming, and what's deliberately out of scope.

This file is updated as direction evolves. For day-to-day work, see [GitHub Issues](https://github.com/crynta/terax-ai/issues) and the Projects board.

## What Terax is

Terax is a fast, lightweight, terminal-first AI-native development environment (ADE). It pairs a native PTY backend with a modern UI: multi-tab terminals, an integrated code editor, a file explorer, source control, and a first-class AI agent system that works with your own API keys or fully local models. About 7-8 MB on disk. No telemetry. Keys stored in the OS keychain.

The product is opinionated: terminal-first, AI as a primitive (not a sidebar), lightweight always, cross-platform without compromise.

## What Terax is not

- Not an IDE clone. Terax selectively integrates high-value editor capabilities such as LSP, AI autocomplete, formatting, source control, and previews without adopting the heavyweight runtime and always-on background services of a traditional IDE.
- Not a browser. Web preview exists for local dev servers and lightweight doc viewing only.
- Not a general workspace. Tools and formats that pull the product away from the terminal-first surface are out of scope.
- Not a one-size-fits-all CLI replacement. The goal is the best terminal-first AI-native development environment, not a shell with extras.

## Themes

The themes below frame every scope decision.

1. **AI as a native primitive.** Agents, tools, autocomplete, voice - first-class, not a panel bolted onto a regular terminal.
2. **Lightweight always.** 7-8 MB binary. Every dependency justified. Per-tab memory budget enforced.
3. **Terminal-first.** xterm.js correctness, PTY fidelity, TUI app compatibility are non-negotiable.
4. **Cross-platform parity.** macOS, Linux, Windows, WSL. No platform-specific exclusives.
5. **Security by default.** Path guards, SSRF protection, OSC trust, IPC sandboxing. Defaults safe out of the box.

## Shipped

### Terminal

- [x] Multi-tab terminal with WebGL renderer
- [x] Native PTY backend (zsh, bash, pwsh, fish, cmd)
- [x] Split panes
- [x] Shell integration (cwd, prompt markers)
- [x] Inline search, link detection, true-color
- [x] Drag and drop files into terminal panes as shell-safe quoted paths
- [x] Private terminal tabs with AI-context redaction
- [x] WSL bridge as workspace environment
- [x] Spaces with restored tabs, working directories, and split-pane layouts

### Editor

- [x] Multi-language support (TypeScript / JavaScript, Rust, Python, HTML / CSS, JSON, Markdown, Go, C / C++ / Java / C#, PHP)
- [x] Inline AI autocomplete with automatic and manual triggering, multiline suggestions, and local-model support
- [x] AI edit diffs
- [x] Opt-in LSP support with diagnostics, navigation, completion, formatting, and custom servers
- [x] Vim mode

### Themes and Customization

- [x] Prebuilt and custom app and terminal themes with import and sharing
- [x] Background images with adjustable opacity and blur
- [x] App-theme-aware and independently selectable editor themes

### File Explorer

- [x] Icon theme with full file-type coverage
- [x] Fuzzy search, keyboard navigation, inline rename, context actions
- [x] Live filesystem updates in the explorer and open editor tabs

### Git / Source Control

- [x] Source control panel (stage, commit, branch)
- [x] Git history with commit graph
- [x] Per-file diffs

### AI

- [x] Multiple cloud and local providers (BYOK)
- [x] Multi-agent and sub-agents
- [x] Approval-gated Claude Code orchestration with spawn, output inspection, and follow-up
- [x] Voice input
- [x] Reusable prompt snippets via `#handle`
- [x] Project memory and per-project configuration
- [x] Tools with per-action approval gating (file write / edit, bash, and filesystem mutations)
- [x] Workspace file picker
- [x] Auto-compact for long context

### Previews

- [x] Auto-detected local dev server preview
- [x] Image, video, audio, and PDF viewers
- [x] Rendered Markdown preview with raw and rendered views
- [x] Sandboxed iframe

### Platform Integration

- [x] macOS, Linux (.deb / .rpm / AppImage), Windows (NSIS), WSL
- [x] AUR (Arch)
- [x] Windows Explorer context-menu integration
- [x] Auto-updater
- [x] OS keychain for API keys
- [x] No telemetry

### Security

- [x] Hardened AI tool surface (file system, network, IPC)
- [x] SSRF and DNS rebinding defenses on outbound HTTP
- [x] Trust gating in terminal escape-sequence handling
- [x] Sandboxed preview surface

### Engineering

- [x] Regression coverage across critical PTY, security, AI tool, editor, explorer, theme, and native-boundary behavior
- [x] Enforced startup and total client bundle budgets with heavy editor, AI, Markdown, and source-control surfaces loaded on demand

## Planned

### Coming next

- [ ] SSH support (PTY auth and known_hosts first; SFTP and port forwarding later)
- [ ] Inline terminal auto-suggestions (history-based first; AI-powered opt-in later)
- [ ] AI agent reliability and workflow improvements (tool execution, context management, recovery, and long-running tasks)
- [ ] Expand external coding-agent orchestration beyond Claude Code
- [ ] Complete, extensible slash-command and reusable skills system
- [ ] Approval flow improvements (YOLO / auto-approve, project-scoped policies, per-tool trust)
- [ ] Persistent terminal processes across app restarts

### Longer horizon

- [ ] Selective TS → Rust migration where the profiler shows measurable wins
- [ ] AI tools / skills as installable bundles

## Wanted contributions

Strategic areas where help is welcome. Pick something and propose an approach in Discord or via an issue first.

- **Regression tests.** Add focused coverage for bug fixes and critical PTY, security, AI tool, and native-boundary invariants.
- **Measured performance work.** Profile first and propose focused changes that preserve startup time, bundle size, memory use, and hot-path latency.
- **Platform-specific bugs.** Rendering issues on niche distros, shell quirks, WSL edge cases.
- **Documentation and translations.** Improvements, screenshots, examples, non-English README sections.
- **Themes.** Terminal and editor themes, UI accent palettes that fit the lightweight aesthetic.
- **Provider integrations.** Only providers that add unique value beyond existing coverage. Justify the case before implementing.

See `good-first-issue` and `help-wanted` labels on GitHub Issues for concrete tasks.

## Out of scope

Categories that will not be built into Terax. Individual feature requests in these categories will be closed.

- **Heavyweight IDE infrastructure.** Integrated debugger and profiler suites, unbounded background indexing, and always-resident extension hosts are out of scope. Focused LSP, autocomplete, formatting, and editor workflows remain in scope when they are opt-in, lazy, and resource-bounded.
- **Notebook and document workspaces.** Anything that turns Terax into a document host rather than a terminal.
- **Package manager and toolchain UIs.** Use `npm`, `pip`, `cargo` and friends in the terminal directly.
- **Full web browser features.** Preview pane stays scoped to local dev servers and lightweight doc viewing. No navigation history, no bookmarks, no dev tools. Sandbox and WebView cookie policies can prevent cookie-based sign-in, so preview offers an external browser fallback instead of relaxing its security boundary.
- **Telemetry, analytics, accounts.** Terax stays BYOK and offline-respectful.
- **Extension marketplaces at IDE scale.** Narrowly-scoped AI tool / skill bundles may happen eventually. Arbitrary UI or behavior extensions will not.
- **Third-party subscription session bridges.** Forwarding cloud subscription auth (provider-managed login sessions) through Terax is not technically feasible for third-party clients.

## Decision authority

Direction and scope decisions are made by [@crynta](https://github.com/crynta). Trusted reviewers (informal, no fixed roles yet) provide input on security, performance, and platform-specific areas.

If a PR is closed and you disagree, raise it in Discord. Happy to discuss, not happy to be ambushed in a PR comment thread.

This will likely formalize over time as the project grows.
