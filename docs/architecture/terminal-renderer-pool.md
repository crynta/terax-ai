# Terminal model ownership and renderer pools

This guide elaborates on `TERAX.md`, which takes precedence.

Every terminal leaf owns one libghostty model and one PTY. Renderer leases never
own terminal state. Switching tabs, changing graphics APIs, or losing a GPU
context cannot reset the parser, scrollback, selection, search, or command blocks.

## Presentation resources

`ghostty/gpu/WebGpuTerminalRuntime.ts` owns the window's device, pipelines, atlas
leases, and damage scheduler. Each frame uses one encoder/submission for eligible
surfaces. Per-pane deadlines bound focused, background-pane, and unfocused-window
cadences to 60, 30, and 15 fps. At most two submissions await GPU completion.

`ghostty/webgl/WebGlTerminalRuntime.ts` pools at most five WebGL2 renderer slots.
Each slot owns a `WebGlCellRenderer`, which consumes the same Ghostty model and
dirty-row information as WebGPU. One idle slot stays warm for up to 30 seconds.
The adapted renderer retains its upstream MIT attribution; no xterm runtime or
addon is installed or shipped.

Hidden tabs release presentation immediately. A window that becomes invisible
pauses rendering, blink, search, and selection work immediately, retaining GPU
resources for two seconds to avoid repeated allocation during desktop switches.
Longer invisibility releases those resources. Native macOS sleep requests immediate
reclamation. Models keep parsing until their leaves close.

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

Read [resource efficiency](ghostty-resource-efficiency.md) for ownership limits,
measurements, and limitations, and [release readiness](ghostty-release-readiness.md)
for the platform and packaged application validation still required.
