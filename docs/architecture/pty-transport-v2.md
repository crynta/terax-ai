# PTY transport v2: one multiplexed pull stream per window

Status: implemented on `perf/resource-efficiency`. Sections below describe what shipped;
"Differences from the first draft" lists what changed and why.

## Why

v1 gives each PTY its own `tauri::ipc::Channel` plus a flusher thread. In
Tauri 2.11 (`ipc/channel.rs`), each send is delivered one of two ways:

- **Under 1 KiB:** `webview.eval("new Uint8Array([27,91,...])")`. The payload
  is a JSON number array that has to be compiled as a script.
- **1 KiB or more:** `webview.eval(...)` followed by a second
  `plugin:__TAURI_CHANNEL__|fetch` round trip.

Each delivered chunk is then acknowledged by a separate synchronous
`pty_ack_output` invoke. Synchronous commands run on the macOS main thread, and
the two-message credit window forces one acknowledgement per chunk. That means
about three cross-process hops and three main-thread tasks per chunk per
terminal, and hidden tabs pay the same as the visible one. Ten agent tabs at
10–30 Hz come to hundreds of main-thread round trips per second.

## Design

### Pull stream

- An asynchronous custom URI scheme, `terax-pty`, registered with
  `register_asynchronous_uri_scheme_protocol`. The frontend keeps exactly one
  outstanding `POST poll` request per webview. The URL is built with Tauri's
  `convertFileSrc(path, "terax-pty")`: `terax-pty://localhost/poll`, or
  `http://terax-pty.localhost/poll` on Windows. CSP `connect-src` allows both.
- **Credential.** `pty_stream_open` (an ordinary command, so only the page's own
  frame can call it) returns a random 64-bit token from OS entropy (no fallback:
  if entropy is unavailable the command fails). Every request carries it. The
  request handler admits a request before the hub thread is touched: the
  `Origin` header must equal the app's own origin (`tauri://localhost`;
  `http(s)://tauri.localhost` on Windows; the dev server's origin when running
  unbundled; absent means token-only), the body must not exceed 12 + 256 x 12
  bytes (`413`), must be well framed (`400`), and must carry the webview's live
  token (`403`, compared in constant time against a table the hub publishes).
  Responses name the allowed origin in `Access-Control-Allow-Origin` with
  `Vary: Origin`, never `*`. Anything else gets `403`. `scripts/pty-smoke` checks
  this in the real webview: wrong token, oversized and malformed bodies, and a
  foreign-origin iframe holding a valid token must all be refused without moving
  the hub's wake-up or request counters. Reopening the stream, a page load or a window
  destruction invalidates the previous token.
- **Request body** (`poll` and `ack`, all little-endian):
  `[u64 token][u32 count]` then `count` x `[u32 pty_id][u64 cumulative_parsed_bytes]`.
  Bodies are validated exactly (length, count <= 256); malformed bodies are `400`.
  The frontend sends at most 64 entries so a body stays under 1 KiB (WebKitGTK reads
  custom-protocol bodies in 1 KiB steps).
- **Response** to `poll`, sent when at least one PTY's output is due, as repeated
  frames of `[u32 pty_id][u8 kind][u32 len][payload]`:
  - `data` (1): `[u64 start_offset][bytes]`, one frame per acknowledgement boundary,
    at most 64 KiB of bytes.
  - `exit` (2): `i32` code.
  - `failed` (3): UTF-8 reason (invalid acknowledgement boundary, reader failure).
  - `sync` (4): empty; native is idle only because it waits on this PTY's
    acknowledgement (credit exhausted, or the shell exited and the exit frame waits
    for the final acknowledgement).
  A response carries many PTYs and many chunks and is capped at 1 MiB (control
  frames use a reserved tail). Anything left over goes in the next poll. An empty
  `200` is a keepalive, sent after 30 s so a webview that dropped the request
  recovers.
- **Attach.** A PTY's output is held natively until the frontend announces its
  receiver with an acknowledgement entry (a zero offset is valid and grants no
  credit). No frame can therefore arrive for an id the frontend has not registered.
  The first terminal's announcement rides on its first poll; later ones cost one
  ack-only request.
- **Acknowledgements while a poll is held.** They ride on the next poll. An
  ack-only `POST ack` is sent only for an announcement, when more than half a
  window of progress is unsent, or after native sent `sync`. The hub applies it,
  wakes, and answers the held poll immediately if that unblocked output.

### Hub

There is one hub thread per process, keyed by webview label. It holds the
outstanding responder per webview and replaces every per-PTY flusher thread.

Readers push into their PTY queue (existing bounded `OutputQueue`) and notify
the hub. The hub picks a coalescing deadline per PTY from its presentation
class:

| Class | Deadline |
|---|---|
| Focused visible | 4 ms interactive, 16 ms sustained (current logic) |
| Visible | 16 ms |
| Hidden pane or tab | 100 ms |
| Window occluded or asleep | 250 ms |

A pending queue of 256 KiB or more is always due immediately. The frontend
reports classes with `pty_set_presentation(ids, class, seq)` (async; `seq` grows per
report and a terminal ignores a report not newer than the last one naming it), and only on
change. Occlusion is applied natively without a round trip. The hub responds
when any due PTY has data, and includes every PTY that has pending data whose
deadline is at most one interactive tick away. That aligns wakeups across
terminals.

### Credit

- Credit is counted per PTY in bytes: in-flight at most 1 MiB (and at most 128
  chunks, bounding the boundary list), pending plus in-flight at most 2 MiB
  (existing bound).
- Acknowledgements are cumulative parsed offsets, validated against delivered
  chunk boundaries. Duplicates and retries cannot add credit (existing
  invariant).
- A PTY whose in-flight bytes are at the limit is skipped by the hub until
  acknowledgements arrive. Unknown or foreign ids in an acknowledgement are ignored (an
  ordinary race with close); a bad boundary fails only that PTY with a `failed` frame.
- Data frames carry their stream offset. The frontend checks it against the bytes it has
  received, so a response lost in transit becomes a visible failure of that terminal rather
  than silently corrupted output.

### Exit and failure

- Exit ordering is preserved. The `exit` frame follows every data frame for
  that PTY, and is sent only after the reader drains and all data is
  acknowledged (existing semantics, including the 30 s post-exit
  acknowledgement deadline and the 2 MiB / 30 s drain bound). Because the final
  acknowledgement may otherwise wait for the next poll, native sends one `sync`
  frame when only that acknowledgement is missing. After a delivery timeout the
  exit frame still follows, with status -1, as soon as the frontend polls.
- Reload drops the held responder (answered `410`), invalidates the token and
  detaches the window's PTYs; their output is closed as when their channel used to
  fail, and the new page's `pty_close_all` reaps them. A destroyed webview's PTYs are
  closed. Window occlusion and sleep come from `WindowPresentationState` and reach the
  hub without a frontend round trip; other platforms report document visibility.
- Parser failure on the frontend stops acknowledgements for that PTY and
  reports it visibly. Other PTYs are unaffected.

### Frontend

- `PtyOutputHub` owns the poll loop and demultiplexes frames to the existing
  `PtyOutputReceiver`s, which keep the 32 KiB / 4 ms sliced parsing.
- Receivers report parsed offsets to the hub, which batches them into the next
  poll or ack request.
- After a response arrives, the next poll is issued immediately, before
  parsing, so delivery latency does not include parse time.
- `pty_open` no longer takes `onData` / `onExit` channels; it takes the initial
  presentation class so a terminal opened in a hidden tab never starts eager.
- Receivers register after `pty_open` resolves; transport retries with capped
  backoff live in the hub, and the receiver keeps the one visible stall/failure state.

## Other per-chunk costs removed

- `agent_detect` and `da_filter` scan with `memchr` and copy runs with
  `extend_from_slice` instead of per-byte pushes.
- The reader checks `closed` with an atomic flag instead of locking the queue
  mutex twice per read.
- `pty_write` no longer uses `spawn_blocking` per keystroke. Each session has a
  writer thread fed by a bounded channel.
- Thread stacks are 128–256 KiB.
- `pty_has_foreground_process` uses `proc_listchildpids` on macOS and
  `/proc/<pid>/task/*/children` on Linux instead of forking `pgrep`.

## Differences from the first draft

- **Stream token** (`pty_stream_open`) instead of relying on the request origin: the
  custom scheme is reachable from every frame, including the preview iframe, while
  commands are not. It also serves as the generation that stale requests fail against.
- **Attach gating** instead of buffering early frames in the frontend: output for a PTY is
  not delivered until its receiver exists, which removes the race between `pty_open`
  resolving and the first poll response and needs no unbounded early-frame buffer.
- **`sync` frame.** With acknowledgements piggybacked on polls, native could wait on a
  final acknowledgement (shell exit) or on credit while the poll stays held. The nudge
  costs one response only in those states.
- **Data frame offsets** and a **30 s keepalive** (defence against lost responses and
  silently dropped requests).
- A byte window of 128 chunks and a 64 KiB frame size, so tiny-chunk streams cannot grow the
  boundary list and acknowledgement granularity stays fine during floods.
- **256 KiB, not 64 KiB, is "due now".** With the poll round trip in the loop, a flood
  answered at 64 KiB ran in lockstep with it: a 16 MiB `cat` took about 250 responses.
  At 256 KiB it takes about 65 at equal or better throughput (measured on macOS, see
  `scripts/pty-smoke`), and a burst between the two thresholds waits only its class
  deadline (4-16 ms focused). One terminal also contributes at most 512 KiB to a
  response, half its credit window, so the next batch is sent while the frontend parses
  this one and several floods share a response.
