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

## Branches

Branch off `main`. Use these prefixes (kebab-case):

| Prefix     | Use for                                  |
| ---------- | ---------------------------------------- |
| `feat/`    | New feature                              |
| `fix/`     | Bug fix                                  |
| `chore/`   | Refactor, tooling, config, dependencies  |
| `docs/`    | Docs-only changes                        |
| `perf/`    | Performance work                         |

Examples: `feat/split-panes`, `fix/explorer-focus`, `chore/windows-bundle-config`.

Don't open PRs from your fork's `main` branch — it makes future syncs painful for you. Always work on a feature branch.

## Issues first for non-trivial work

For anything beyond a typo, a small bug fix, or a clear `good-first-issue` — **open an issue first** and wait for a maintainer to ack the approach. A 10-minute conversation saves a 500-line PR that doesn't fit the roadmap.

If an issue already exists for what you want to do, comment "I'll take this" before starting so we don't duplicate work.

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

We squash-merge every PR — the **PR title becomes the squash commit**, so it should follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(terminal): add split panes
fix(explorer): prevent input from disappearing on create
chore(deps): bump tauri to 2.x
docs(readme): clarify Linux install on Arch
```

Types: `feat`, `fix`, `chore`, `docs`, `perf`, `refactor`, `test`, `build`, `ci`.
Common scopes: `terminal`, `editor`, `explorer`, `pty`, `ai`, `settings`, `tabs`, `shortcuts`, `agents`, `ui`.

Within a PR, individual commit messages can be whatever — they get squashed.

**One logical change per PR.** A PR that adds a feature, fixes an unrelated bug, and reformats `.gitignore` is three PRs. Split them.

**Open a draft PR early** if you want feedback mid-flight; mark "Ready for review" when done. Fill out the PR template — what changed, why, how you tested. Include screenshots / GIFs for any UI change.

### What gets merged faster

- Clear problem statement
- Small, focused diff
- Follows existing patterns (read 2-3 nearby files before writing yours)
- `pnpm exec tsc --noEmit` clean
- Manual testing notes ("I tested by doing X, Y, Z")

### What gets bounced back

- Mixed-concern PRs ("split this please")
- Large architectural PRs without prior discussion
- New dependencies without justification
- Breaking changes without migration notes
- Incidental reformatting unrelated to the change (adds noise to review)
- AI-generated code that obviously wasn't read by the author

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
