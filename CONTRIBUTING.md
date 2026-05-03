# Contributing

Thanks for wanting to help. Issues, PRs, and ideas are all welcome.

## Quick start

```bash
pnpm install
pnpm tauri dev
```

Prereqs: Rust (stable), Node 20+, pnpm, plus your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Before opening a PR

Run these and make sure they pass:

```bash
pnpm exec tsc --noEmit          # frontend types
cd src-tauri && cargo clippy    # Rust lint
cd src-tauri && cargo fmt       # Rust format
```

Build a release bundle at least once if you touched anything in `src-tauri/`:

```bash
pnpm tauri build
```

## What we want

- **Bug fixes** — always.
- **Features** — open an issue first if it's non-trivial. We'd rather discuss the approach than reject a finished PR.
- **Docs / typos / small UX fixes** — just send the PR.
- **New AI providers** — see `src/modules/ai/providers/`. Keep BYOK; no hardcoded keys.
- **Themes / icon packs** — yes, but keep the bundle size in check.

## What we don't want

- Telemetry, analytics, or anything that phones home.
- Hardcoded API keys or accounts. Terax stays BYOK.
- Large dependencies for small wins. The bundle is ~7 MB and we want it to stay light.
- Sweeping refactors with no functional change.

## Code style

- Follow the existing patterns. Read adjacent files before adding new ones.
- TypeScript: no `any` unless you really mean it.
- Rust: `cargo fmt` + `clippy` clean.
- Few comments. Code should explain itself; comments are for the *why*, not the *what*.
- No emoji in code or commit messages.

## Commits & PRs

- Commit titles short and contextual: `area: what changed`. Look at `git log` for examples.
- One logical change per PR. Don't bundle unrelated fixes.
- Describe what and why in the PR body, plus how you tested it. Screenshots / GIFs for UI changes.

## Project layout

```
src-tauri/        Rust backend — PTY, FS, shell, plugins
src/
  modules/
    terminal/     xterm.js sessions + OSC handlers
    editor/       CodeMirror stack
    explorer/     File tree
    tabs/         Tab model
    ai/           Agents, sessions, tools, mini-window
    header/       Top bar + search
    statusbar/    Bottom bar
    shortcuts/    Keymap
  components/     shadcn/ui + AI Elements
```

## Security issues

Don't file them as issues — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree your work is licensed under [Apache-2.0](LICENSE).
