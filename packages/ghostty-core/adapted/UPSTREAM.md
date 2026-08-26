# Terax Ghostty WASM adaptation

This is the production-candidate terminal core for the pooled Terax renderer
architecture. It adapts the mature bulk render-state bridge from Restty
without importing Restty's application runtime, PTY transport, perpetual
per-terminal frame loop, or per-pane GPU lifecycle.

- Ghostty source: `https://github.com/ghostty-org/ghostty`
- Ghostty commit: `e9db8d2b0b827be035ab75658ea9faf4f0f56d3f`
- Restty source: `https://github.com/wiedymi/restty`
- Restty commit: `7700b14a7643ba9240818209ef1e0aa90d83ad77`
- Zig: `0.16.0`
- Optimization: `ReleaseFast`, baseline WebAssembly target
- Artifact size: `650361` bytes
- Artifact SHA-256: `ed4a16b152710c53039d3dd2ddbdb94e7b0ba0205c9e4d6811efb03150cd0633`

Terax-specific changes include:

- rebasing the bridge onto the pinned current Ghostty API;
- Ghostty `TinyIo`, avoiding the binary and runtime overhead of threaded I/O;
- independent hard byte and line limits for scrollback;
- a 256 KB maximum retained terminal-reply queue per terminal;
- raw `Uint8Array` PTY writes and replies with no UTF-8 round trip;
- native Ghostty key encoding and terminal mode queries in the same instance;
- native tracked selections that survive streaming and reflow, clamp when
  partially pruned, and release their tracked pins deterministically;
- bounded parser-owned semantic events for shell and product integration;
- native mode, size, color, visibility, and version query replies;
- generated upstream Ghostty XTGETTCAP responses and native DECRQSS replies;
- synchronized-output state for damage suppression with bounded recovery;
- one shared WASM instance with one terminal handle per Terax model;
- Ghostty's module-global exact-page WASM pool, avoiding per-terminal geometric
  page-pool growth while reusing released pages across tabs;
- cached typed views that are recreated only when WASM memory or pointers move;
- capacity-aware render buffers with bounded headroom, preventing allocation
  churn during repeated window fitting and adjacent-size resize cycles;
- bounded reusable PTY input, terminal-reply, grapheme, and hyperlink bridge
  storage with oversized transient buffers released after use;
- row-level damage hashes computed inside WASM for bounded renderer uploads;
- direct typed render-state consumption without a per-frame JS cell repack;
- extended underline styles and colors, overline, inverse-aware decoration
  colors, text blink, graphemes, and wide-cell state;
- a raw `.wasm` asset instead of a multi-megabyte JavaScript string literal.

The bridge deliberately stays below Terax's model/surface boundary. Terax
retains renderer pooling, hidden-tab renderer release, damage-driven frame
scheduling, shell integration, semantic routing, and fallback selection.

## Memory regression gate

The allocator rebase was measured against the previous pinned artifact with an
identical five-terminal, approximately 16 MiB-per-terminal ASCII workload.
Total WASM linear memory after the workload fell from 20,119,552 bytes to
8,978,432 bytes. The current tests also gate fresh multi-terminal allocation,
adjacent resize stability, oversized transient release, and a three-terminal
Unicode-heavy agent workload. These measurements cover linear memory only;
process RSS and GPU allocations are separate release gates.

## Rebuild

From `packages/ghostty-core/adapted/wasm`:

```sh
zig build -Dtarget=wasm32-freestanding -Doptimize=ReleaseFast
cp zig-out/bin/terax-ghostty-vt.wasm ../ghostty-vt.wasm
shasum -a 256 ../ghostty-vt.wasm
```

`build.zig.zon` pins both the Ghostty archive URL and Zig package hash. A
checksum change must be reviewed together with the source revision and the
terminal compatibility and resource gates.
