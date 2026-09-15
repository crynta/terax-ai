# Terax contributor documentation

This directory holds long-form contributor and maintainer guides. `TERAX.md` at the repo root is the living architecture doc and the source of truth; these guides elaborate on specific areas without duplicating it.

If a guide conflicts with `TERAX.md`, `TERAX.md` wins.

## Getting started

- [TERAX.md](../TERAX.md) - the architecture source of truth; read this first
- [CONTRIBUTING.md](../CONTRIBUTING.md) - how to contribute, quality bar, project layout

## Architecture guides

- [Two-process model and IPC command reference](architecture/two-process-model.md) - Rust owns all OS access; the webview talks through `invoke()`. Command catalog and how to add a new command.
- [PTY shell integration](architecture/pty-shell-integration.md) - PTY sessions, shell init scripts, OSC 7 / 133, ConPTY, CONPTY_LIFECYCLE_LOCK, Job Object, WSL.
- [Security model](architecture/security-model.md) - deny-list, SSRF guard, workspace authorization, AI tool approval, IPC allowlist, OSC trust, keychain handling.
- [AI subsystem](architecture/ai-subsystem.md) - providers, agent, sub-agents, sessions, composer, tools, edit diffs, live context bridge. Includes a walkthrough for adding a new provider.
- [Terminal renderer pool](architecture/terminal-renderer-pool.md) - persistent Ghostty models, bounded presentation leases, and renderer recovery.
- [Ghostty WebGL renderer](architecture/ghostty-webgl-renderer.md) - adapted xterm.js renderer, Ghostty model boundary, renderer pooling, and rollout gates.
- [CLI control plane](architecture/cli-control.md) - bundled CLI, authenticated local protocol, caller targeting, packaging, and current platform limits.

## Terminal migration and validation

- [Release readiness](architecture/ghostty-release-readiness.md) - release gates, verification evidence, and remaining platform validation.
- [Resource efficiency](architecture/ghostty-resource-efficiency.md) - resource ownership, measurement tools, results, and limitations.
- [Final resource audit, 2026-09-07](architecture/ghostty-final-audit-2026-09-07.md) - fixes and measurements at that checkpoint, with raw profile and soak data.
- [Review dispositions, 2026-09-07](architecture/ghostty-review-2026-09-07.md) - reviewed findings, decisions, and supporting checks.
- [Original WebGPU migration design](architecture/ghostty-webgpu-migration.md) - historical design and staged implementation record.

Dated reports and their raw JSON data preserve evidence for specific revisions;
they do not replace the current architecture or establish full release readiness.
These contributor documents and test-only reference WASM cores stay in the
repository and are not included in the application bundle.

## Contributing guides

- [Testing](contributing/testing.md) - the testing contract, how to run checks, and what makes a good core-subsystem test.
