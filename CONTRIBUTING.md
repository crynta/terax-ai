# Contributing to Terax

Terax is a solo-maintained project with a strong product direction. Contributions are welcome, but **alignment matters more than volume**.

This document helps you decide *whether* and *how* to contribute in a way that's likely to get merged, so neither of us wastes time.

## How this project is run

- Terax has one active maintainer ([@crynta](https://github.com/crynta)).
- Review bandwidth is limited.
- Not every contribution can be accepted, even if it's technically correct. Alignment with project direction matters as much as code quality.
- For scope and direction, see [ROADMAP.md](ROADMAP.md). Read it before opening anything non-trivial.

This is normal for a solo project. A "no" on a PR is not personal.

## Quick start

```bash
pnpm install
pnpm tauri dev
```

Prereqs: Rust (stable), Node 20+, pnpm, plus your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Where to discuss

Discord: [Crynta OS](https://discord.gg/tyveTUyEp7)

Use Discord for design discussion, scope questions, "should I work on X?", quick feedback. Use GitHub Issues for tracking concrete bugs and features.

## What makes a good contribution

These get merged fast:

- **Bug fixes** with clear reproduction steps.
- **Docs / typos / small UX fixes** - open a PR directly.
- **Pre-discussed features** - alignment in an issue or Discord first.
- **Small, focused changes** - easy to review, low risk.

If your change is small and obvious (typo, narrow bugfix, small docs change), open a PR directly. No issue required.

## Keep changes focused

**Only change what's needed to accomplish your stated goal.**

If you're fixing a bug in `terminal.tsx`, don't also:

- Reformat other files
- Clean up unrelated code
- Fix lint issues in files you didn't need to touch
- Combine multiple unrelated fixes in one PR

Even when these changes are "improvements", they make review harder and slow everything down. If you want to clean things up, open a separate PR after discussion.

**One PR = one logical change.** Multi-concern PRs will be asked to split.

## Discuss first (required for larger changes)

For anything beyond a small fix, **discussion is required before opening a PR**. This includes:

- New features
- UI/UX changes or changes to default behavior
- Refactors or "cleanup" work
- Performance rewrites
- Architectural changes
- Anything touching many files or systems
- New AI providers

Pull requests with significant unsolicited changes will be closed without detailed review. This isn't meant to discourage contribution. It ensures alignment before significant work goes in.

A 10-minute conversation saves a 500-line PR that doesn't fit the roadmap.

## Quality bar

Terax positions itself as **lightweight, fast, production-grade**. Every PR is reviewed against:

- `pnpm exec tsc --noEmit` clean
- `cargo clippy` clean, `cargo fmt` applied
- `pnpm test` and `cargo test` pass
- No perf regressions in known hot paths: terminal renderer, PTY stream, AI streaming, source control, file explorer
- No new heavy dependencies (>50KB gzip in client bundle, >5MB compiled on Rust side) without justification
- Platform parity preserved (macOS / Linux / Windows / WSL still work)
- Security review for changes to AI tool surface, file system access, network paths, IPC commands

If you're not sure how to measure perf or what counts as a hot path, ask in Discord or an issue. Better to confirm than get bounced.

## What Terax is not

To set expectations:

- Terax is not trying to be a full IDE replacement (VS Code, Cursor, Zed).
- Not building: full LSP support, Jupyter notebooks, integrated debugger UI, package manager UI, full web browser.
- This is not a curated "first open-source contribution" project. Beginners are welcome but expect normal review.
- Mechanical refactors, broad style changes, drive-by rewrites are not helpful.
- AI-assisted contributions are welcome, but the PR must reflect understanding of the existing patterns. Low-effort AI-generated code that wasn't read by the author will be closed.

## Branches

Branch off `main`. Use these prefixes (kebab-case):

| Prefix       | Use for                                  |
| ------------ | ---------------------------------------- |
| `feat/`      | New feature                              |
| `fix/`       | Bug fix                                  |
| `chore/`     | Refactor, tooling, config, dependencies  |
| `docs/`      | Docs-only changes                        |
| `perf/`      | Performance work                         |
| `security/`  | Security fix or hardening                |

Examples: `feat/split-panes`, `fix/explorer-focus`, `security/path-guard`.

Don't open PRs from your fork's `main` branch. Work on a feature branch.

## Commits & PRs

The **PR title becomes the squash commit** for most PRs. Multi-commit PRs with well-crafted atomic commits may be merged with a merge commit at the maintainer's discretion (security audits, multi-step refactors). Title must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(terminal): add split panes
fix(explorer): prevent input from disappearing on create
chore(deps): bump tauri to 2.x
security(ai): tighten path guard
```

Types: `feat`, `fix`, `chore`, `docs`, `perf`, `refactor`, `test`, `build`, `ci`, `security`.

Common scopes: `terminal`, `editor`, `explorer`, `pty`, `ai`, `agents`, `settings`, `tabs`, `shortcuts`, `ui`, `git`, `preview`, `windows`, `linux`, `macos`, `wsl`.

Within a PR, individual commit messages can be free-form (they get squashed or grouped).

**Fill out the PR template.** Include: what changed, why, how you tested. Screenshots/GIFs for UI changes. "Tested manually by ..." is the bare minimum.

**Open a draft PR early** if you want feedback mid-flight. Mark "Ready for review" when done.

### What gets merged faster

- Clear problem statement
- Small, focused diff
- Follows existing patterns (read 2-3 nearby files before writing yours)
- All type-checks / lints / tests pass
- Manual testing notes describing the steps you took

### What gets bounced back

- Mixed-concern PRs
- Large architectural PRs without prior discussion
- New dependencies without justification
- Breaking changes without migration notes
- Incidental reformatting unrelated to the change
- AI-generated code that obviously wasn't read by the author

## Code style

- Follow existing patterns. Read 2-3 adjacent files before adding new ones.
- TypeScript: no `any` unless you really mean it. Strict mode is on.
- Rust: `cargo fmt` + `clippy` clean.
- Comments: only for *why*, not *what*. Code should explain itself. No multi-paragraph docstrings.
- No emojis in code or commit messages.
- American English in user-facing strings.

## Project layout

```
src-tauri/                  Rust backend
  src/modules/
    pty/                    Terminal sessions, shell integration, DA filter
    fs/                     File system commands
    git/                    Source control
    net/                    AI HTTP proxy with SSRF guard
    workspace/              WSL bridge, workspace env

src/
  modules/
    terminal/               xterm.js sessions, OSC handlers, renderer pool
    editor/                 CodeMirror stack, AI autocomplete
    explorer/               File tree
    tabs/                   Tab/split model
    ai/                     Agents, sessions, tools, providers, mini-window
    git-history/            Git graph and history pane
    source-control/         Source control panel
    preview/                Image / Markdown / web preview
    settings/               Settings UI and preferences store
    shortcuts/              Keymap
  app/                      Top-level App.tsx
  components/               shadcn/ui + AI Elements
```

## FAQ

**Q: Should I ask before fixing a typo or obvious bug?**
A: No, open a PR directly.

**Q: I have an idea for a new feature.**
A: Open a GitHub issue or bring it to Discord. Don't open a PR without prior discussion.

**Q: My PR was closed without detailed feedback.**
A: Usually means it didn't align with project direction, or scope was too large to review responsibly. This is normal for a solo project. Reopen is welcome if you want to take another pass at a smaller scope.

**Q: Can I work on an open issue?**
A: Comment first to confirm it's still relevant and nobody else is on it. For anything non-trivial, discuss approach before implementing.

**Q: I noticed cleaner code I could write while working on my fix.**
A: Focus on your stated goal. Submit cleanup as a separate PR after discussion if it matters.

**Q: How long does review take?**
A: Depends. Small bug fix or docs: usually within a few days. Larger feature: maybe a week or two. Pre-discussed work moves faster.

**Q: Why did my PR for a new AI provider get closed?**
A: Most provider requests are now covered by the `openai-compatible` provider (point it at any OpenAI-compatible base URL) or OpenRouter. New built-in providers must justify unique value beyond what those cover.

**Q: My PR conflicts after main moved. Should I rebase?**
A: If the change is still relevant and reasonably small, yes. If it's a large stale PR, expect it to be closed with an offer to reopen after rebase. Rotting velocity is real, not personal.

## Security issues

Don't file them as public issues. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree your work is licensed under [Apache-2.0](LICENSE). No CLA required.
