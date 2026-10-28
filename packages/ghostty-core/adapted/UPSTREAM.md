# Terax Ghostty WASM adaptation

This is the production-candidate terminal core for the pooled Terax renderer
architecture. It adapts the mature bulk render-state bridge from Restty
without importing Restty's application runtime, PTY transport, perpetual
per-terminal frame loop, or per-pane GPU lifecycle.

- Ghostty source: `https://github.com/ghostty-org/ghostty`
- Ghostty commit: `ad97d331459a0762f7aea5f56fe86748e03b860f`
- Restty source: `https://github.com/wiedymi/restty`
- Restty commit: `7700b14a7643ba9240818209ef1e0aa90d83ad77`
- Zig: `0.16.0`
- Optimization: `ReleaseFast`, WebAssembly SIMD and scalar variants
- SIMD artifact size: `755388` bytes
- Scalar artifact size: `753322` bytes
- SIMD SHA-256: `302b7952e0f84d1701b64a4348f597bbe5ab2bc1f2b58c12d6cf775251a895f7`
- Scalar SHA-256: `c9cffe386b771bd1a76b493bf064b30abb30fd5ef3d36d700226b318309c1cad`

Terax-specific changes include:

- rebasing the bridge onto the pinned current Ghostty API;
- Ghostty `TinyIo`, avoiding the binary and runtime overhead of threaded I/O;
- independent hard byte and line limits for scrollback;
- a 256 KB maximum retained terminal-reply queue per terminal;
- raw `Uint8Array` PTY writes and replies with no UTF-8 round trip;
- prompt input capability for shells that need direct input instead of blocks;
- native Ghostty key encoding and terminal mode queries in the same instance;
- native tracked selections that survive streaming and reflow, clamp when
  partially pruned, and release their tracked pins deterministically;
- bounded parser-owned semantic events for shell and product integration;
- optional parser-time command markers with 2,048 tracked pins per terminal,
  exact endpoint columns, full signed exit codes, and deterministic cleanup;
- parser-time block invalidation for primary-screen clear and reset, retaining
  bounded marker capacity and preserving later markers within the same write;
- direct text range extraction independent of viewport or selection state;
- current geometry queries even before a hidden terminal synchronizes rendering;
- native mode, size, color, visibility, and version query replies;
- generated upstream Ghostty XTGETTCAP responses and native DECRQSS replies;
- synchronized-output state for damage suppression with bounded recovery;
- one WebAssembly instance (one linear memory) per Terax model, all created
  from a single compiled module; disposing the model drops the instance, which
  is the only way WebAssembly memory is ever returned to the operating system;
- Ghostty's module-global exact-page WASM pool, avoiding geometric page-pool
  growth; it is per terminal now because the pool lives in the instance;
- a 96 KiB shadow stack placed below the data (`-Dwasm-stack-kib`, default 96),
  so a blank instance is 5 pages (320 KiB) instead of 20 and an overflow traps
  instead of corrupting memory;
- `restty_set_scrollback_limits` and `restty_scrollback_page_bytes`, which let
  the host divide a global scrollback budget without pruning held history;
- upstream OSC SIMD scanning plus row-recycling, cursor, hyperlink, C0/C1,
  Kitty clipboard, and page-pointer correctness fixes through the pinned tip;
- synchronous SIMD capability detection with a scalar Ghostty artifact for
  older webviews, preserving the same model and renderer architecture;
- cached typed views that are recreated only when WASM memory or pointers move;
- capacity-aware render buffers with bounded headroom, preventing allocation
  churn during repeated window fitting and adjacent-size resize cycles;
- one reallocatable cell-buffer arena instead of sixteen independent WASM
  allocations, removing resize fragmentation and transient high-water growth;
- lazy cell-buffer allocation, with cell arrays, graphemes, links and placement
  snapshots returned to the allocator when presentation is released;
- explicit post-gesture bridge and render-state compaction with hysteresis;
- periodic render-state renewal after 100,000 updates, releasing fragmented
  row arenas and retained high-water allocations during long-running agents;
- explicit presentation-state release for hidden panes and hidden documents,
  with lazy rebuilding that preserves the terminal, selection, and scrollback;
- bounded reusable PTY input, terminal-reply, grapheme, and hyperlink bridge
  storage with oversized transient buffers released after use;
- direct consumption of libghostty's global and per-row dirty state, avoiding
  redundant full-viewport hashing and bridge-array rewrites;
- stable append-only grapheme and hyperlink storage between partial frames,
  with bounded full compaction after high-water thresholds;
- persistent hyperlink interning by owned buffer offsets, avoiding both repeated
  URI retention on dirty rows and borrowed pointers into recycled terminal pages;
- direct typed render-state consumption without a per-frame JS cell repack;
- a per-terminal render format (`restty_set_render_format`): 0 keeps the
  structure-of-arrays cells for the WebGL fallback, 1 writes GPU cell records
  and none of the SoA arrays (hyperlink ids, wrap flags and the cursor stay);
- GPU cell records: 16 bytes per cell in one persistent capacity-managed
  buffer (`glyph_id | attrs << 24`, then fg, bg and underline RGBA8 with
  inverse applied and faint as alpha 128), laid out for WGSL `unpack4x8unorm`;
- exact row dirtiness: rows Ghostty marks dirty but rewrites with identical
  content are compared word by word and not reported, so Ink-style redraws
  cost one native compare; stale records (first frame, resize, release, new
  glyph epoch) report full damage;
- per-terminal glyph interning (codepoint or grapheme content x bold x italic,
  dense ids from 1, capped at 16,384 with an epoch reset) delivered as a
  `[id][style][count][codepoints...]` stream, plus a visible blinking-glyph
  count so text-blink timers arm only when needed;
- viewport-independent buffer line reads (`restty_line_cells_*`) for word and
  line selection, block search and URL detection in either format;
- extended underline styles and colors, overline, inverse-aware decoration
  colors, text blink, graphemes, and wide-cell state;
- a raw `.wasm` asset instead of a multi-megabyte JavaScript string literal.

The bridge deliberately stays below Terax's model/surface boundary. Terax
retains renderer pooling, hidden-tab renderer release, damage-driven frame
scheduling, shell integration, semantic routing, and fallback selection.

## October 15 instance-per-terminal memory

A single shared instance can never give memory back: WebAssembly memory only
grows, so twenty agent tabs left the app at their joint high-water mark until
every model was gone. Each model now owns an instance of one cached
`WebAssembly.Module`. Measured with `pnpm profile:ghostty` (Node 24) and in a
real WKWebView on macOS 26 (footprint of the WebContent process):

- blank instance: 1,310,720 bytes before, 327,680 after (stack 1 MiB to 96 KiB;
  Ghostty needs at most 35,200 bytes on the adversarial soak below);
- one 120x40 terminal: 2,097,152 bytes before, 1,114,112 after; 20 blank
  terminals: 10,944,512 bytes shared, 22,282,240 private (the cost of isolation);
- synchronous instantiation of the cached module: 0.075 ms median in V8 (0.12 ms
  with the terminal) and 0.5 to 1.4 ms in JavaScriptCore (1 to 2 ms with the
  terminal in WKWebView, 1 ms timer resolution);
- open 20 heavy terminals (about 9 MiB of scrollback each), close 15: Node
  external memory 186 MB to 49 MB (shared instance: 175 MB to 174 MB); WKWebView
  footprint 247 MB to 73 MB, and 26 MB after the last close.

An idle WKWebView does not collect a dropped memory for many seconds, so the
loader creates a one-page `WebAssembly.Memory` 250 ms after a burst of disposals;
WebKit and V8 both collect when it is allocated (`reclaim` option). With the hint
the footprint is back within about a second (212 MB after one second without it).
`node scripts/ghostty-webkit-memory.mjs` repeats the WKWebView run.

Stack safety: `pnpm soak:ghostty` writes about 33 MB of adversarial input per
artifact and render format (1 MiB OSC strings, 200,000-parameter SGR, nested
string introducers, DCS/APC/kitty floods, 100,000 combining marks, malformed
UTF-8, scroll-region extremes, reflow, search, selection, key encoding) with a
canary in the stack. The deepest use is 35,200 bytes (36%) in every artifact
and format; the soak and `GhosttyWasmStack.test.ts` fail above 50%. With the
4 KiB stack that was tried, the first write traps with a memory access error.

Known limits: JavaScriptCore keeps only eight instances on fast signal-checked
memory; instances past the eighth use explicit bounds checks and parse about
1.8x slower in a pure-parse microbenchmark (14.7 ms to 27 ms per 200,000 lines).
Calls from JavaScript into many different instances are polymorphic, which adds
about 0.4 microseconds to a write plus render-state update.

## October 14 upstream update

Both artifacts use the exact `main` revision above (141 commits after the
previous `7ec9e26a` pin). Terax continues to use its adapted bulk bridge; it does
not consume the mutable official nightly binary as a drop-in ABI. Upstream
changes that matter to Terax:

- use-after-free when scrollback pruning frees the page holding the cursor
  (ghostty-org/ghostty#14686), which long-running agent sessions that prune
  constantly would otherwise hit;
- grapheme preservation when a widening reflow wraps cells, DECSTR (soft reset)
  handling, and wide-character selection fixes;
- DECXCPR (`CSI ? 6 n`, answered `CSI ? row;col;1 R`) and `CSI 19 t`
  (`CSI 9;rows;cols t`) were added to upstream's device-status and size-report
  enums. The bridge's exhaustive switches required matching replies in
  `terax.zig`; no other bridge behavior changed.

Linear memory is unchanged from the previous pin: 20 blank 120x40 models use
10.4375 MiB, and the block-enabled stress workload plateaus at 68.1875 MiB for
both variants with zero plateau growth. Artifacts grew by 4,099 (SIMD) and 4,172
(scalar) bytes. This source update is not claimed as an application CPU or RAM
saving. Native canvas reuse and row-staging measurements are recorded separately
in `docs/architecture/ghostty-resource-efficiency.md`.

The GPU cell-record format (`TERAX_SOAK_FORMAT=gpu`, `TERAX_PROFILE_FORMAT=gpu`)
keeps the blank allocation and plateaus 786,432 bytes lower (67.4375 MiB) with
zero plateau growth. The format added about 16 KiB to each artifact.

## September memory regression gate

The September 7 pin includes upstream page allocation, default-palette sharing
and fixed terminal allocation reductions. There is no tagged stable standalone
libghostty WASM release in the inspected release list; Terax still builds its
adapted bridge from an exact source revision, rather than consuming the nightly
artifact or treating Ghostty's application version as a stable library ABI.

The update alone saved only one 64 KiB WASM page across 20 blank 120x40 models.
With Terax's lazy presentation arrays, the identical workload uses 10,878,976
bytes instead of 16,187,392 bytes at `0e3fae9`, a 5,308,416-byte reduction.
Isolated per-artifact row-edit, scrolling and OSC microbenchmarks were within
roughly 2% of baseline; this is not evidence of an application CPU speedup.
See `docs/architecture/ghostty-resource-efficiency.md` for reports and limits.

The allocator rebase was measured against the previous pinned artifact with an
identical five-terminal, approximately 16 MiB-per-terminal ASCII workload.
Total WASM linear memory after the workload fell from 20,119,552 bytes to
8,978,432 bytes. The current tests also gate fresh multi-terminal allocation,
adjacent resize stability, oversized transient release, and a three-terminal
Unicode-heavy agent workload. These measurements cover linear memory only;
process RSS and GPU allocations are separate release gates.

## Rebuild

From `packages/ghostty-core/adapted/wasm` (add `-Dwasm-stack-kib=N` to change the
96 KiB shadow stack; `pnpm soak:ghostty` reports the deepest stack use):

```sh
zig build -Dtarget=wasm32-freestanding -Doptimize=ReleaseFast
cp zig-out/bin/terax-ghostty-vt.wasm ../ghostty-vt.wasm
zig build -Dtarget=wasm32-freestanding -Doptimize=ReleaseFast -Dwasm-simd=false
cp zig-out/bin/terax-ghostty-vt.wasm ../ghostty-vt-scalar.wasm
shasum -a 256 ../ghostty-vt.wasm ../ghostty-vt-scalar.wasm
```

`build.zig.zon` pins both the Ghostty archive URL and Zig package hash. A
checksum change must be reviewed together with the source revision and the
terminal compatibility and resource gates.

Both variants run the same adapted-core regression suite. The Rust integration
test `ghostty_artifacts` additionally validates the scalar binary with SIMD and
relaxed SIMD disabled and confirms that the primary binary requires SIMD.
`pnpm bench:ghostty` compares both variants at the same source revision; those
measurements exclude IPC, webview presentation, process RSS, and energy.
