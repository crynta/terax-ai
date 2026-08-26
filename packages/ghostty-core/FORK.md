# Terax Ghostty core lineage

The production-candidate core is the maintained adaptation documented in
`adapted/UPSTREAM.md`. It is built from current pinned Ghostty source and uses
selected low-level bridge work from Restty. It is the model loaded by the
experimental `ghostty-webgl` and `ghostty-webgpu` backends.

The files described below are the first Ghostty WebAssembly integration kept
temporarily for compatibility tests and source history. They are not imported
by the active experimental runtime and Vite tree-shakes their WASM artifact
from the production application bundle.

## Legacy ghostty-web fork

Upstream: `https://github.com/coder/ghostty-web`

Pinned upstream commit: `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`

Pinned Ghostty commit: `5714ed07a1012573261b7b7e3ed2add9c1504496`

The tracked `ghostty-vt.wasm` is built from the pinned Ghostty source with
Zig 0.15.2 in `ReleaseSmall` mode and the maintained patch in
`patches/ghostty-wasm-api.patch`.

- Size: 425994 bytes
- SHA-256: `c71bd0acb45de12d3d3652366ecf524061044894251853723415aceaa9682499`

The fork patch provides the packed render ABI, response handling, scrollback,
mode queries, a bounded semantic event queue, and WebAssembly allocation
helpers. It also explicitly zeroes WASM terminal page allocations. Native Ghostty relies on anonymous memory
mappings for that guarantee, but the freestanding WASM allocator can reuse
dirty memory. Without this fix, empty cells can expose stale codepoints and
cause unbounded glyph-atlas churn.

To verify the source patch against a clean checkout:

```sh
git -C /path/to/ghostty checkout 5714ed07a1012573261b7b7e3ed2add9c1504496
git -C /path/to/ghostty apply --check \
  /path/to/terax/packages/ghostty-core/patches/ghostty-wasm-api.patch
```

This fork retains the upstream MIT license. Terax imports only the low-level WASM bridge and input encoder. Rendering, scheduling, PTY transport, and GPU resource ownership live outside this package.

## Unmodified official ABI evaluation

`official/ghostty-vt.wasm` is a separately pinned, unmodified upstream
ReleaseFast artifact used to evaluate the upstream C ABI. It is intentionally
not a silent replacement for the active adapted core. See
`official/UPSTREAM.md` for its checksum and provenance.

The official wrapper uses Ghostty's bulk raw-row RenderState API and one
shared typed WASM callback dispatcher for PTY replies. Keeping both cores
available behind tests lets Terax track upstream ABI progress without coupling
the renderer or product architecture to an incomplete integration path.
