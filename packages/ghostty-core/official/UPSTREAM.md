# Official libghostty WASM artifact

This directory contains the production-candidate official libghostty WASM
artifact. It is kept beside, but not yet substituted for, Terax's older custom
compatibility core.

- Upstream: `https://github.com/ghostty-org/ghostty`
- Commit: `cecf81678e47f967b0354acada67e69d229f436b`
- Artifact: upstream `ReleaseFast` `ghostty-vt.wasm`
- Size: 849558 bytes
- SHA-256: `13f9440aa2e1afaa2ec4c48b7560cea14ec4ab4ae90cc0292bdbadb034290a01`
- Optimization: upstream `wasm-opt -O3` release pipeline

The wrapper in `../lib/official` reads C struct offsets from
`ghostty_type_json()` rather than hardcoding unstable WASM offsets. It grows
the function table once per WASM instance and installs one typed callback
dispatcher shared by every terminal. This enables native libghostty terminal
effects such as `write_pty` without patching the upstream binary or creating a
callback table entry per tab.

The application does not select this core by default yet. It must pass the
Fish, shell integration, formatter, selection, link, scrollback, IME, TUI, and
long-running agent gates before it replaces the existing compatibility core.
