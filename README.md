<div align="center">
  <img src="public/logo.png" width="144" height="144" alt="TerMax" />
  <h1>TerMax</h1>

  <p><strong>Personal fork of <a href="https://github.com/crynta/terax-ai">Terax</a> — lightweight terminal-first AI-native dev workspace.</strong></p>

  <p>
    <img src="https://img.shields.io/github/v/release/RiotBeard/termax?label=version&color=blue" alt="version" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
    <img src="https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)-lightgrey" alt="platform" />
  </p>
</div>

---

TerMax is a personal fork of [Terax](https://github.com/crynta/terax-ai), distributed only as a signed + notarized Apple Silicon build through a personal Homebrew tap. Functionality and credit for the upstream design and code go to [@crynta](https://github.com/crynta). This fork only changes branding, distribution, and removes the auto-updater (Homebrew handles updates instead).

If you want the official cross-platform builds (macOS Intel, Linux, Windows), get them from [crynta/terax-ai](https://github.com/crynta/terax-ai) — this fork is for personal use.

## What it is (from upstream)

A lightweight open-source terminal built on Tauri 2 + Rust and React 19. Native PTY backend with a WebGL renderer, agentic AI side-panel that runs against your own keys or fully local models, plus code editor, file explorer, source control with git graph, and a web preview pane. About 7-8 MB on disk. No telemetry. No account.

For the full feature list, screenshots, and roadmap, see the [upstream README](https://github.com/crynta/terax-ai#readme).

## Install

```sh
brew tap RiotBeard/tap
brew install --cask termax
```

Updates ship as new releases on this repo; `brew upgrade --cask termax` pulls the latest.

## Configure AI

1. Open **Settings → AI**.
2. Pick a provider and paste your API key. For local inference, point TerMax at your LM Studio / MLX / Ollama endpoint.
3. Keys are written to the OS keychain via `keyring`. They never touch disk or localStorage.

## Build from source

**Prerequisites**
- Rust ≥ 1.85 stable (`rustup update stable`)
- Node 20+ and [pnpm](https://pnpm.io)
- Xcode Command Line Tools
- For signed/notarized builds: a Developer ID Application cert in your keychain and an App Store Connect API key — see [plan.md](plan.md) (Phase 3) for setup.

**Run**
```sh
pnpm install
rustup target add aarch64-apple-darwin
pnpm tauri dev                                # development
pnpm tauri build --target aarch64-apple-darwin  # production bundle
```

**Checks**
```sh
pnpm exec tsc --noEmit          # frontend type-check
cd src-tauri && cargo clippy    # Rust lint
```

## Syncing with upstream

After pulling new commits from upstream, re-apply the fork's customizations:

```sh
git fetch upstream && git merge upstream/main
./scripts/strip-upstream.sh
cd src-tauri && cargo check
pnpm exec tsc --noEmit
```

See [plan.md](plan.md) for the full end-to-end release procedure (build → notarize → release → cask bump).

## Attribution

TerMax is derived from [crynta/terax-ai](https://github.com/crynta/terax-ai), licensed under Apache 2.0. See [NOTICE](NOTICE) for the list of modifications and [LICENSE](LICENSE) for the original Apache 2.0 license, both preserved unchanged.

## License

Apache-2.0. See [LICENSE](LICENSE).
