# Terminal renderer pool

This guide elaborates on `TERAX.md`. If anything here conflicts with `TERAX.md`, `TERAX.md` wins.

## Why a pool exists

Terminal tabs are kept mounted and hidden on switch so PTYs and dev servers keep streaming in the background. Creating an unbounded number of live xterm + WebGL renderer instances would blow the memory budget, so Terax pools renderer slots.

The pool lives in `src/modules/terminal/lib/rendererPool.ts`.

## Slot lifecycle

- `POOL_MAX_SIZE` is 5 (`rendererPool.ts:22`). Each slot owns one xterm `Terminal`, `FitAddon`, `SearchAddon`, `SerializeAddon`, and optionally a `WebglAddon`.
- A slot is created on demand and assigned to a leaf on bind.
- `releaseSlot` detaches a slot from a leaf. If the leaf is idle, the slot is parked with `display:none` so xterm stops rendering but keeps parsing PTY bytes.
- After a grace period, idle slots may be reaped to keep the pool size down.

## Parking vs releasing

When a leaf becomes hidden:

1. `parkLeafSlot` sets the host to `display:none`. Rendering pauses but the live buffer keeps receiving bytes.
2. If the leaf is **busy** (foreground command, agent signal, alt-screen TUI, or block-shell running mode), it keeps the slot parked indefinitely.
3. If the leaf is **idle**, `releaseSlot` is called after `HIDDEN_RELEASE_DELAY_MS`. The slot's `currentLeafId` is cleared and `retainedLeafId` is set so the buffer stays live.

When the leaf becomes visible again, `acquireSlot` looks for:

1. A slot already bound to this leaf.
2. A retained slot for this leaf (`retainedLeafId === leafId`) - fast path, no snapshot replay.
3. A clean idle slot.
4. If the pool is at max size, the lowest-scoring slot is evicted. Eviction serializes the retained buffer to a snapshot via `SerializeAddon` before stealing the slot.

## The DormantRing

`src/modules/terminal/lib/dormantRing.ts` buffers PTY bytes for leaves that have no slot at all (stolen or never bound). It is capped at 1 MiB and drops oldest blocks on overflow. On drain it resumes from the next line boundary rather than resetting the terminal, so a mid-line escape sequence is not replayed from the middle.

## The never-serialize-mid-command invariant

This is the most important rule in the pool. A leaf that is in the middle of a command must **never** be serialized. Replaying incremental TUI repaints over a stale snapshot is what used to wipe Claude Code.

The code enforces this by checking `isLeafBusy` before eviction and by keeping slots parked (not released) while `commandRunning`, `isAgentActivePty`, or alt-screen is true.

## Fast path and snapshot replay

If a retained slot exists for a leaf, `bindSlot` skips `term.clear()` / `term.reset()` and simply drains the DormantRing into the live buffer. This avoids re-rendering a large snapshot.

If only a snapshot exists, `bindSlot` clears the terminal, resizes, writes the snapshot, then drains the ring. For alt-screen TUIs, the snapshot is skipped and a SIGWINCH kick is sent so the TUI repaints from scratch.

## WebGL lifecycle

WebGL addons are created when a slot becomes visible and reaped after a grace period when parked. The addon recovers from context loss on sleep/wake or GPU reset.

## Invariants

- Never allow the pool to grow without bound; max is `POOL_MAX_SIZE`.
- Never serialize or evict a leaf that is mid-command or in alt-screen.
- A hidden busy leaf keeps its live grid parked with `display:none`.
- An idle hidden leaf releases its slot but the buffer continues parsing bytes.
- The DormantRing only buffers bytes for leaves without any slot.

## See also

- [`TERAX.md`](../../TERAX.md) - the architecture source of truth
- [`docs/README.md`](../README.md) - index of contributor guides
- [PTY shell integration](pty-shell-integration.md) - sessions, OSC sequences, and ConPTY
