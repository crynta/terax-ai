# Terminal model ownership and renderer pools

This guide elaborates on `TERAX.md`, which takes precedence.

Every terminal leaf owns one libghostty model and one PTY. Renderer leases never
own terminal state. Switching tabs, changing graphics APIs, or losing a GPU
context cannot reset the parser, scrollback, selection, search, or command blocks.

## Presentation resources

`ghostty/gpu/WebGpuTerminalRuntime.ts` owns the window's device, pipelines, glyph
atlases (one per font and display ratio, shared by every surface that uses it),
and damage scheduler, and one `WebGpuWindowCanvas` per terminal area: every visible
WebGPU pane draws into its device-pixel rectangle of that shared canvas, and a
presented canvas is never destroyed or resized by a tab switch, split or divider
drag. Each frame uses one encoder/submission and one render pass for all panes.
Per-pane deadlines bound focused, background-pane, and unfocused-window
cadences to 60, 30, and 15 fps. At most two submissions await GPU completion.

`ghostty/webgl/WebGlTerminalRuntime.ts` pools at most five WebGL2 renderer slots.
Each slot owns a `WebGlCellRenderer`, which consumes the same Ghostty model and
dirty-row information as WebGPU. One idle slot stays warm for up to 30 seconds.
The adapted renderer retains its upstream MIT attribution; no xterm runtime or
addon is installed or shipped.

Hidden tabs leave the window canvas immediately (their cell buffers and atlas lease are
released); the canvas itself is never destroyed or resized by tab switches, because WebKit
retains destroyed or retired WebGPU swapchains. An occluded, sleeping or hidden window pauses
rendering, blink, search and selection work and keeps its GPU resources. WebGL slots (per pane)
are still released on long invisibility. Models keep parsing until their leaves close.

## Blocks and accessibility

Command blocks belong to the model/session, including their tracked native pins.
Their controller and overlay load lazily, with bounded history and text metadata.
Block presentation stops while hidden or occluded. The shared shell editor owns
prompt input; interactive commands and alternate-screen applications own grid
input. Both presentation backends apply the same input and cursor policy.

Accessible output is opt-in, lazy, bounded, and suspended with window presentation.
It reads native text ranges without moving the renderer viewport or selection.

## Recovery

Renderer replacement is transactional: attach the replacement and transfer search
before disposing the previous presentation. A failed WebGL fallback displays a
retry action while preserving the live model and PTY. Never serialize, replay,
clear, or respawn a terminal to repair presentation.

See [renderer v2](terminal-renderer-v2.md) for the window canvas and its lifecycle,
[resource efficiency](ghostty-resource-efficiency.md) for budgets and measurement, and
[release readiness](ghostty-release-readiness.md) for the validation still required.
