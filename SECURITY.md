# Security

> **This is a personal fork.** TerMax shares its security surface with upstream [Terax](https://github.com/crynta/terax-ai) — bugs in the codebase should go to upstream so all users benefit. Report fork-specific issues (the `RiotBeard/homebrew-tap` cask, the signing pipeline, or modifications in `scripts/strip-upstream.sh`) by opening a private GitHub security advisory on `RiotBeard/termax`.

---

TerMax / Terax runs shells, reads/writes files, and talks to AI providers — so security bugs matter. If you find one, please tell the right party before posting publicly.

## Reporting (upstream)

Email **security@terax.app**. Include:

- What the issue is and what it lets an attacker do
- Steps to reproduce (a small PoC is great)
- Version, OS, arch

We'll get back to you within a few days. Once it's fixed, we'll credit you in the release notes — unless you'd rather stay anonymous.

Please **don't** open a public GitHub issue for security reports.

## Supported versions

Until `1.0.0`, only the latest minor gets security fixes. Right now that's `0.5.x`. 

## What's in scope (upstream)

- The Rust backend in `src-tauri/` (PTY, FS, IPC, plugins)
- The frontend in `src/` — anywhere untrusted input lands (terminal output, file content, AI tool results, credentials)
- Release artifacts on GitHub and `terax.app`
- The auto-updater (upstream only — this fork has it removed)

## What's in scope (this fork specifically)

- The Apple Developer ID signing identity and notarization pipeline used to ship TerMax releases
- The `RiotBeard/homebrew-tap` cask URL and SHA pinning
- Anything introduced by `scripts/strip-upstream.sh` or fork-only files (`NOTICE`, AboutSection rewrite)

## What's not

- Bugs in upstream deps (Tauri, xterm.js, CodeMirror, AI SDKs…) — report those upstream. We'll ship the fix once it's released.
- Anything that needs an already-compromised machine or a local attacker with shell access
- Older versions (`< 0.5`)

## What we do to keep things safe

- **API keys** live in the OS keychain via `keyring` — not on disk, not in `localStorage`, not in logs.
- **No telemetry.** Terax only talks to the network when you ask it to (AI requests, update checks, web preview).
- **AI tool approval.** File writes and shell commands from the agent need your OK before they run.
- **No Node in the renderer.** The frontend only reaches the host through the allow-listed Tauri commands.
- **Signed releases.** Updates are verified before they're applied.

## What we can't promise

- Terax runs whatever you (or the agent) tell it to run, with your permissions. That's kind of the point of a terminal.
- AI providers see whatever you send them. Read their retention policies.
- Local LLM endpoints (LM Studio, OpenAI-compatible) are trusted at the network level — only point Terax at servers you control.
