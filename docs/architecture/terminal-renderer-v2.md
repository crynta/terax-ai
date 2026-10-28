# Terminal renderer v2: native cell stream, pixel-exact grid

Status: shipped in 0.9.0 for WebGPU (macOS verified; Windows/Linux pending real
hardware). The WebGL fallback keeps the structure-of-arrays (SoA) path and shares
integer device cells, procedural glyphs and the resize rules.

## Why

v1 copied every dirty cell three times per frame (Ghostty `RenderState` → eleven
SoA buffers → ~12 JS accessor reads and a 64-byte instance per cell, blanks
included). Agent TUIs (Ink, Claude Code, Codex) rewrite their dynamic region on
every spinner tick and Ghostty marks those rows dirty even when unchanged, so
the per-cell JavaScript ran every tick. Cell geometry was CSS pixels × ratio, so
at fractional ratios (Windows 125%/150%) glyphs landed between device pixels and
were linearly filtered: the Windows text blur.

## Bridge (Zig → GPU)

Zig: `packages/ghostty-core/adapted/wasm/src/terax.zig`; TS:
`packages/ghostty-core/lib/adapted/` (`gpuCells.ts`) and
`GhosttyTerminalModelApi.consumeGpuFrame()`. Tests: `AdaptedGhosttyGpu.test.ts`,
`AdaptedGhosttyGpuModel.test.ts` (incl. a randomized cell-by-cell equivalence
check against the SoA path).

**Format.** `restty_set_render_format(handle, 0 | 1)`: SoA (WebGL) or GPU.
`consumeGpuFrame()` selects GPU; `renderCells()`, `viewport()` and
`consumeDamage()` select SoA (switching forces full damage, so a surface stays on
one format). Text readers (selection, block search, URL hover) use
`readLines`, which works in either format without scrolling the viewport.

**Cell records.** `rows * cols` row-major records, four little-endian u32 words:

| word | bits | meaning |
| --- | --- | --- |
| 0 | 0..23 | glyph id; 0 draws nothing (blank, invisible, spacer tail, Kitty placeholder) |
| 0 | 24..26 | underline: 0 none, 1 single, 2 double, 3 curly, 4 dotted, 5 dashed |
| 0 | 27 / 28 / 29 / 30 | strikethrough / overline / blink / wide lead (31 reserved) |
| 1 | RGBA8 | foreground, inverse applied; alpha 128 when faint |
| 2 | RGBA8 | background, inverse applied |
| 3 | RGBA8 | underline color (falls back to the displayed foreground) |

RGBA words are `[r, g, b, a]` in memory order, what WGSL `unpack4x8unorm` reads.
A spacer tail repeats its lead's colors so the lead's background covers both cells.

**Exact dirtiness.** Each natively dirty row is re-encoded and compared word by
word before it is stored; only rows whose bytes changed are reported. Identical
TUI redraws therefore cost one native compare and no JavaScript. `fullDamage` is
set only when stored records are stale (first frame, resize, released buffer,
new glyph epoch).

**Glyph ids.** `(codepoint or grapheme) × (bold, italic)` interns to dense ids
per terminal handle. At most 16,384 glyphs; when full, a new epoch clears the
table and re-encodes the viewport. New glyphs stay pending until acknowledged, so
a skipped frame loses nothing.

**Consumer loop.**

```ts
if (model.deferPresentation()) return;           // synchronized output / prompt hold
const frame = model.consumeGpuFrame({ resync });  // resync: new/re-leased surface
if (frame.epoch !== epoch) { glyphMap.reset(); epoch = frame.epoch; }
for (const glyph of frame.newGlyphs) glyphMap.add(glyph.id, glyph.text, glyph.style);
for (const { start, end } of frame.dirtyRanges) {
  const offset = start * cols * 16;
  queue.writeBuffer(cellBuffer, offset, frame.cells, offset, (end - start + 1) * cols * 16);
}
```

`frame.cells` is borrowed from WASM memory: upload before any other model call.

## GPU side

- **Bindings.** One bind group: uniform (176 bytes, offsets checked against the
  TS packer by a test), `cells`, `glyph_map` (u32 per glyph id → atlas index or
  pending), `glyph_table` (rect, size, bearing, flags: color / exact coverage),
  `search_mask` (only while a search is active), two atlas textures.
- **Background pass.** One fullscreen triangle per pane; the fragment derives its
  cell from the pixel and applies background, search, selection, cursor and
  decorations.
- **Glyph pass.** One instanced draw over `cols * rows`; glyph 0, pending and
  blink-hidden glyphs collapse to degenerate triangles. Quads sit on integer
  device pixels and sample with `textureLoad` (no filtering). The left-overhang
  clip against a different background is kept.

## Pixel-exact geometry

Fonts are measured at `size * ratio`; the device cell is
`ceil(advance + letterSpacing * ratio)` by
`max(ceil(ascent + descent) + 2, ceil(size * ratio * lineHeight))`. The CSS cell
(device / ratio, fractional is fine) is used for fit, hit testing, selection and
IME; rendering uses device pixels only. Strokes are `max(1, round(ratio))`
device pixels, bar/underline cursors `max(2, round(ratio))`. The canvas is
translated by the negative fractional device offset of the terminal area
(computed in observer callbacks, on ratio change and window resize, never per
frame), and pane rectangles are rounded edge by edge relative to it.
`devicePixelContentBoxSize` supplies the exact size where the engine reports it.

Grayscale antialiasing at ratios below 2 (and on Windows/Linux) gets
DirectWrite-style contrast (`DWrite_EnhanceContrast` scaled by foreground
lightness, blended toward `DWrite_ApplyAlphaCorrection` with Windows Terminal's
1.8 gamma ratios). macOS Retina output is unchanged.
`localStorage["terax:terminal-text-contrast"]` (`off`, `on` or a strength) tunes
it without a build; the defaults (0.5 / 0.5) still need a look on real Windows.

## Window canvas

All visible WebGPU panes of a window draw into one canvas covering the terminal
area (`gpu/WebGpuWindowCanvas.ts`, the `[data-terminal-area]` layer behind
`TerminalStack`'s tab layers). Each pane renders into its device-pixel rectangle
(`gpu/PaneRects.ts`) with `setViewport` + `setScissorRect`; the shader takes the
viewport origin and size from the uniform, so a pane is pixel-identical to a
canvas of its own. Canvas textures are not preserved between frames, so a window
frame clears and encodes every visible pane (no per-cell CPU work); an unchanged
window acquires no texture. Rectangles come from resize observers on layout
changes (plus a once-a-second recheck while frames are produced); nothing reads
the DOM per frame. Pane DOM (scrollbar, selection, IME, block overlays) stays
above the canvas and is transparent once the pane's first frame is shown.

**Lifecycle.** WebKit (macOS 26) keeps the swapchain of a presented-then-destroyed
WebGPU canvas in the WebContent process for good (~30 MiB for 2000×1300), and
every swapchain a resizing canvas retires until JavaScriptCore collects its
wrappers. Reproduced with raw WebGPU, no Terax code (`--workload canvas`):
destroying a canvas per occlusion cycle +30 MiB/cycle; keeping it hidden 0. So:

- A presented canvas is never destroyed, unconfigured or shrunk while the runtime
  lives. Occlusion, sleep and editor tabs pause it; tab switches, splits and
  divider drags change only viewports (zero allocations). Device loss reconfigures
  the same element. Only `WebGpuTerminalRuntime.dispose()` tears it down.
- Every submitted frame drops a ~129 KiB `ArrayBuffer` (`gpu/GcPressure.ts`):
  a frame's wrappers pin ~13 KiB of native memory JavaScriptCore does not count,
  so without this it collects them after minutes (~20 MiB/min for a streaming
  agent). Ten times the native cost keeps young-generation collections steady
  with no measurable CPU change.
- The WebGL fallback stays per pane (its canvases are garbage collected normally).

## Resizing

Every SIGWINCH makes zsh/fish and Ink-based agents redraw; redraws that do not
line up with a reflowed grid leave duplicates in scrollback. So during a resize
gesture (native macOS live resize via `NSWindowWillStart/DidEndLiveResize`; pane
divider drags; elsewhere a burst of size changes < 150 ms apart) neither the model
nor the PTY changes. The pane follows the pointer at display rate and draws its
existing grid, shifted up (`shift_y`) so the cursor row stays visible when the
pane is shorter, clipped or padded otherwise. At release `TerminalResizeSync`
resizes the model and the PTY in one call (as upstream Ghostty #14706 does under
its terminal lock). Ghostty clears a redrawable prompt on that resize, so the pane
holds its previous frame until the shell's redraw or 70 ms
(`core/ResizePromptHold.ts`, OSC 133 prompts only, never the alternate screen).

During a gesture the canvas backing is grow-only: shrinking keeps it, outgrowing
it allocates once to the largest reachable size (screen room for a window drag,
capped by the device limit), and it compacts at release: at most one growth and
one compaction per drag. WebKit itself still allocates a new viewport-sized page
tile per live-resize step; an empty page peaks at ~420 MiB during a drag. On macOS
the document gets an invisible size rounded up to 512 px while a drag is in
progress (`modules/theme/livePageResize.ts`), so the tile and its buffers are
reused.

## Glyph atlas

Shared per (font, ratio). Pixels go up with `queue.writeTexture` and no CPU copy;
coverage grows 1024² → 2048² → 4096² by GPU copy (color 512² → 2048²). When full,
an epoch flush (at most every 250 ms, between frames) makes each surface
re-rasterize only its visible glyphs; when more than 256 glyphs wait, only visible
ones stay queued. Rasterization is budgeted at ~2 ms per frame (8 ms for a
surface's first frame).

**Procedural glyphs.** Box drawing (U+2500–257F), block elements (U+2580–259F),
braille (U+2800–28FF), powerline separators (U+E0B0–E0BF, E0D2, E0D4), corner
triangles and the common Symbols for Legacy Computing (sextants, octants, smooth
mosaics, eighth bars) are drawn from the cell, not the font, with Ghostty's sprite
geometry (`gpu/BuiltinGlyphs.ts`, `gpu/builtin/`, pure and shared with WebGL), so
borders and bars join seamlessly at every size and ratio. 746 of 885 glyphs are
bit-identical to Ghostty's reference images; the anti-aliased rest differ by at
most 29/255 on edge pixels. They ignore bold/italic and skip the contrast curve.

**Scrollbar.** The last written `scrollTop` is kept in JS; the DOM is read only in
the scroll handler. A bottom-pinned thumb moves at most every 100 ms, ARIA at most
every 250 ms.

## Results (real app, M4, release build)

| | before | after |
| --- | --- | --- |
| Main-thread time per Ink-like tick, 3.9k / 12k cells | 0.98 / 2.51 ms | 0.14 / 0.36 ms |
| Identical full repaint | 3.64 ms | 0.15 ms |
| Same text at ratio 1.25 / 1.5 (mean abs. difference between columns) | 6.8 / 11.2 | 0 / 0 |
| 40 tab switches, 4 tabs incl. a split pair (total MiB after 30 s) | 726 | 218 |
| Occlusion cycles (MiB per cycle) | +29.7 | ~0 |
| Window drag peak (MiB) | 1,373 | ~620 |
| Divider drag fps (100 Hz panel) / resizes per gesture | 43 / 46 | 91 / 1 |
| Idle focused terminal CPU / wakeups per second | 3.1 % / 254 | 0.24 % / ~11 |

Reproduce with `pnpm profile:app` (real app, `docs/architecture/app-lab.md`),
`pnpm profile:renderer:*` (isolated renderer) and `scripts/terminal-visual`
(pixel readback).

## Not verified

Windows (WebView2) and Linux (WebKitGTK) on real hardware: text contrast
defaults, `devicePixelContentBoxSize` at real fractional ratios, long-held
custom-protocol requests, and whether WebKitGTK takes the WebGL path. Procedural
glyph line weight assumes the bundled font's 5% underline thickness.
