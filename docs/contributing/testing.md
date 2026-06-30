# Testing

This guide elaborates on `TERAX.md` and `CONTRIBUTING.md`. If anything conflicts with those files, they win.

## Running checks locally

The canonical commands are what CI runs (`.github/workflows/ci.yml`):

```bash
pnpm lint
pnpm check-types
pnpm test

cd src-tauri
cargo clippy --all-targets --locked -- -D warnings
cargo nextest run --locked        # CI uses nextest
```

If you do not have `cargo-nextest` installed, `cargo test --locked` is the local fallback. Install nextest with `cargo install cargo-nextest`.

## What must have a test

`CONTRIBUTING.md` requires a test for any change that touches behavior in these load-bearing paths:

- Shell / terminal spawn (what shell launches, with which cwd, env, and login flags)
- Workspace authorization (both the allow and deny side)
- Git command layer (repo-root resolution, pathspec/argument guards, status parsing)
- Filesystem mutation (atomic writes, symlink handling, no-data-loss on partial failure)
- IPC command surface and AI tool surface
- Pure logic with wide reach (cwd inheritance, tab/split tree transforms, OSC/prompt parsing, command guard)

The bar is real coverage of the contract, not a placeholder. Test the edge, the deny path, the "what happens one level above home".

## What does not need a test

UI rendering, themes, syntax-highlight tables, and anything the type-checker already guarantees do not need tests.

## Writing a good test

A good test locks the invariant you are relying on. Examples from the codebase:

- `src-tauri/src/modules/workspace.rs` `auth_tests` verify that an authorized path, a subdir of an authorized root, an unauthorized path, a missing path, and a symlink escape all behave correctly.
- `src-tauri/src/modules/pty/job.rs` tests verify that dropping the Job Object kills the assigned process tree on Windows.
- `src-tauri/src/modules/pty/session.rs` tests verify that dropping a `Session` kills the child process.
- `src-tauri/src/modules/pty/shell_init.rs` tests verify shell classification and WSL fish launch specs.
- `src/modules/ai/lib/security.ts` is exercised by tests that assert specific paths are refused and that canonicalization catches symlink traversal.

## Cross-platform PTY tests

Platform-specific behavior must be gated:

```rust
#[cfg(unix)]
fn shell_has_children(shell_pid: u32) -> bool { ... }

#[cfg(windows)]
fn shell_has_children(shell_pid: u32) -> bool { ... }
```

Tests for ConPTY/Job Object belong behind `#[cfg(windows)]`; tests for Unix PTY lifecycle belong behind `#[cfg(unix)]`. Do not assume a helper that works on one platform works on the other.

## Security function tests

When testing `src/modules/ai/lib/security.ts` or the Rust equivalents, cover:

1. The literal path is refused.
2. The canonicalized path is re-refused (symlink case).
3. Case variants match on case-insensitive filesystems.
4. NTFS alternate data streams and trailing dot/space variants are normalized.
5. Write-only deny prefixes block writes but allow reads where appropriate.

## Invariants

- A local fix with global blast radius must be caught by a test; review alone is not enough.
- Test the deny path and the edge, not just the happy path.
- Keep platform-specific tests behind the right `#[cfg(...)]` gate.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) - quality bar, project layout, how to contribute
- [`docs/README.md`](../README.md) - index of contributor guides
