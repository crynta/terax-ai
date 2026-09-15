# Ghostty PR review, September 7

Review: [PR 1223](https://github.com/crynta/terax-ai/pull/1223), CodeRabbit's
September 7 review of `4834c01`. All 26 major findings and the documentation
index comment were checked against the implementation. No PR comments were
posted and no review threads were marked resolved automatically.

## Dispositions

| Finding | Disposition |
| --- | --- |
| PTY exit can wait forever for credit | Fixed. After child exit, a 30-second acknowledgment inactivity deadline wakes blocked readers and flushers. Valid progress renews it; successful drains retain final output. Timeout logs the undelivered byte counts and reports exit status -1. It is armed before ConPTY close and either thread join. Live shells have no new timeout or heartbeat. |
| Inconsistent, lossy ESC paste handling | Fixed the inconsistent single-line submission path. Retained the deliberate policy of rendering ESC as U+241B inside bracketed paste, including malicious end delimiters. We do not silently remove substrings or allow copied escape sequences to break out of paste framing. Ordinary single-line commands keep their existing encoding. |
| Receiver rejects a third pending chunk | No change. Rust negotiates exactly two in-flight chunks. Cumulative credit is granted only after parsing, so three unparsed chunks violate the protocol. Existing asynchronous parser and credit tests cover this boundary. Removing the check would weaken the object-count bound. |
| Checkout credentials remain accessible during installation | Fixed all five CI checkouts with `persist-credentials: false`. These jobs do not push commits. |
| URL suffix trimming is quadratic | Fixed with one delimiter count and one suffix scan. Tests include 30,000 mixed closing delimiters and balanced IPv6/path delimiters. |
| Clear leaves text before the cursor on row zero | Intended behavior. The clear action preserves the current prompt/command line while removing earlier output and history. Added a repeated-clear assertion at row zero. Shell erase sequences independently clear block metadata. |
| Block search scans an entire command synchronously | Fixed with batches of at most 128 lines or approximately four milliseconds, a 500-match cap, cancellation, and a pending indicator. Closing or replacing a query cancels it; clearing, pruning its start pin, reflow, or disposal invalidates it. Search scans the whole retained range rather than silently dropping matches after an arbitrary line cap. |
| Metadata eviction can remove the live block | Not reachable with current bounds. A command is capped at 8,192 UTF-16 units and cwd at 32,768, totaling 40,960, below the 262,144-unit budget. The newest entry remains after older entries are removed. Existing tests verify the newest command survives budget pressure. |
| Large accessible append announces its oldest portion | Fixed to announce the newest 2,048 characters of the changed suffix. |
| Focus recreates accessible subscriptions and announces the viewport | Fixed. Focus is read through an effect event, and losing focus clears the old announcement without recreating the model subscription. |
| Legacy scrolled viewport rebuilds on every read | Removed the unused legacy application model. The file now contains only the shared model contracts. Production already uses the adapted model. |
| Legacy reply drain can loop on an empty response | Removed with the unused legacy application model. |
| ShellInput loses a draft when unmounted in plain mode | Fixed by saving before editor destruction and retaining that saved value in the later registration cleanup. |
| Old WebGL boolean preference is not migrated | No change. The old boolean chose xterm WebGL versus its software renderer. The new setting chooses WebGPU versus WebGL, both GPU renderers. Mapping false to WebGL would not preserve a software-renderer preference; mapping true to WebGL would force every prior default user onto the fallback. New settings default to Automatic and preserve explicit WebGL choices. |
| Scrollbar reads layout on every frame | Fixed. Geometry comes from fitting; unchanged history, offset, geometry, and modes skip DOM reads and writes. Native scrolling and presentation changes invalidate the cache. Fractional positions remain intact. |
| Idle atlas destruction races GPU work | Partially valid. Encoded but unsubmitted uploads now prevent every idle reclamation path, including the warm-atlas timer, without repeated timer wakeups. Destroying resources after submission is permitted by WebGPU and does not require extending their JavaScript ownership until completion. |
| WebGL background changes rebuild the full grid | Stable per-row rectangle counts now use dirty-row construction and range uploads. Structural changes still rebuild the compact rectangle stream. This retains one background draw without reserving worst-case per-cell rectangle storage or adding one draw per row. GPU buffer capacity is reused, and rectangle uploads are counted. |
| Failed configuration poisons reused WebGL slots | Fixed for new, idle/reused, and already-leased renderers. A failed slot is detached, disposed, and removed before retry. |
| Official wrapper retains freed input storage after OOM | Fixed pointer/capacity ownership and tested retry and immediate disposal against the real reference WASM with allocator failure injection. This bridge is test-only. |
| Adapted wrapper retains freed input storage after OOM | Fixed with the same failure-injection coverage for the production bridge. |
| Legacy bridge calls WASM after terminal free | Guarded native access after disposal and released the cached cell pool. This bridge remains only for compatibility comparisons. |
| Legacy InputHandler bypasses native navigation encoding | Removed the unused handler and its package export. Production input uses `GhosttyInputController` and native key encoding. |
| Legacy cell pool returns stale entries after shrinking | Fixed the active pool length while retaining a stable array between reads. |
| Legacy viewport/scrollback allocation can return zero | Added allocation checks and cleared freed pointer/capacity state before allocation. Both read paths have failure-injection tests. Also corrected its input-buffer retry ownership. |
| Oversized legacy semantic events lose framing | Decoder now skips the declared payload across chunks using a bounded counter and emits one overflow event. Payload bytes cannot become event headers; subsequent valid events remain decodable. |
| Legacy InputHandler conflates Ctrl+Alt with AltGr | Removed the unused handler. Production composition/key behavior stays in the existing tested controller. |
| Architecture index describes retired mechanisms | Updated the index to the ConPTY lifecycle lock and persistent models with presentation pooling. |

The atlas disposition follows the [WebGPU texture destruction contract](https://gpuweb.github.io/gpuweb/#texture-destruction):
previously submitted operations retain the resource until their GPU use completes.
Encoded commands must still retain valid resources until submission.

## Validation and limits

- 163 frontend test files, 1,128 tests; 353 Rust tests.
- Type checking, production build, Clippy with warnings denied, and all five
  asset budgets pass. Lint retains the pre-existing 89 warnings and one info.
- The WebGL test changes one background row in a 24-row terminal: 36 background
  bytes uploaded, versus the previous 864-byte full stream, with no GPU buffer
  reallocation. This is an upload regression measurement, not an application
  CPU or energy benchmark.
- Startup JavaScript: 228.09 kB gzip; primary Ghostty chunks: 45.97 kB; lazy
  WebGL: 14.04 kB; both WASM variants: 413.4 kB. The WASM artifacts are unchanged.

These checks do not establish packaged WKWebView, WebKitGTK, WebView2, ConPTY,
assistive-technology behavior, or multi-day process memory and energy stability.
The desktop-transition memory spike remains unattributed. The existing
[release gates](ghostty-release-readiness.md) still apply before declaring
cross-platform production readiness.

## Follow-up review of 121b3d1

All five findings in CodeRabbit's 09:20 UTC review were checked against the
implementation, including the three comments outside the diff. No review replies
were posted or threads resolved automatically.

| Finding | Disposition |
| --- | --- |
| A descendant holding a Unix PTY slave prevents shutdown | Fixed with an interruptible reader. Live reads sleep indefinitely on PTY readiness and an explicit wake descriptor; there is no periodic polling. Child exit wakes the reader and drains ready bytes without waiting for an inherited slave to close. Continuing descendant output is capped at 2 MiB / 30 seconds and reports failure rather than silently claiming a complete drain. Explicit close, session drop, and channel failure also wake the reader. The existing output credit bound and Windows ConPTY ordering remain intact. |
| A WebGL surface retains a renderer disposed during failed acquisition | Fixed by clearing surface ownership before acquisition and before reporting exhausted recovery. Theme, font, DPR, and resume failures use the same bounded recovery path. Tests cover successful replacement with selection preserved and failure of both the original configuration and recovery. Subsequent resize work cannot reach the retired renderer. |
| Block cwd fails home abbreviation with Windows separators | Fixed with a shared normalized home-path formatter for block headers and the workspace input bar. Tests cover both separators, exact home paths, outside paths, and near-prefix directory names. |
| Deferred atlas cleanup requires another call on GPU completion | No runtime change. `GlyphAtlas.completeSubmission()` synchronously moves encoded uploads into submitted ownership. The end of that same `flushFrame()` then rearms deferred cleanup, before the completion callback, even with no dirty surfaces. A regression test exercises actual atlas encoding, lease release, submission, completion, and timed destruction without scheduling another frame. Reaping on every GPU completion would add unnecessary work. |
| Preserve raw ESC by splitting bracketed paste frames | Rejected. Terminal paste framing has no portable literal-ESC quoting contract across receiving applications; inserting raw ESC outside a frame can expose it to command/key interpretation. The pinned upstream Ghostty encoder also sanitizes ESC, including in bracketed paste. Terax retains its visible U+241B substitution and the existing tests for embedded closing delimiters and single-line submissions. |

The paste disposition was checked against the pinned
[Ghostty paste encoder](https://github.com/ghostty-org/ghostty/blob/f426f6f181ba95f45d33f683fb754b6359d9e04f/src/input/paste.zig).
That encoder replaces ESC and other unsafe control bytes with spaces. This is
evidence for sanitizing terminal text insertion, not a claim that our complete
paste policy is identical to Ghostty's.

### Follow-up validation and performance tradeoff

- 165 frontend files / 1,140 tests and 356 Rust tests pass. One new native
  throughput experiment is ignored in the normal suite and was run explicitly.
- Types, production build, Clippy with warnings denied, and all five asset
  budgets pass. The seven changed frontend files have no lint findings; overall
  lint retains 89 existing warnings and one info. Both WASM artifacts are unchanged.
- Real macOS PTYs verify retained-slave shutdown with final output preserved,
  explicit cancellation of an idle reader, and a lossless 4 MiB live-output drain.
- The interruptible reader adds a readiness syscall to live reads. An isolated
  macOS arm64 comparison of six alternating 32 MiB drains per reader measured
  median elapsed times of 244.46 ms (blocking) and 277.25 ms (interruptible), about
  13.4% longer for the latter. The initial run overlapped other checks and varied
  more; it is not used for this comparison. Neither run includes IPC, filtering,
  the terminal model, or GPU rendering. This fixes a shutdown deadlock at a
  measurable raw-read cost; packaged throughput and energy validation remain open.

Reproduce the native comparison from `src-tauri`:

```sh
cargo test --locked compare_pollable_and_blocking_reader_throughput -- --ignored --nocapture
```

The prior pushed head `121b3d1` passed frontend, coverage, Rust/Linux, Rust/macOS,
Rust/Windows, and terminal/macOS and terminal/Windows CI. New commits must pass
the same CI gates. Those jobs do not establish packaged webview behavior or
multi-day resource stability; the existing release gates remain open.

## Follow-up review of 4c59c89

Checked all four findings in CodeRabbit's 11:39 UTC review, including its outside
diff comment and platform-validation nitpick.

| Finding | Disposition |
| --- | --- |
| Unix reader tests fail to compile on Windows | False positive. The enclosing `tests` module already has `#[cfg(all(test, unix))]`; both cited `Session` initializers are inside it. The separate portable `flow_control_tests` module remains enabled on Windows. Windows Rust CI passed on the reviewed head. No Rust change is needed. |
| Windows home-path comparison should ignore casing | Fixed for drive and UNC paths while retaining POSIX case sensitivity and directory boundaries. Only the compared home prefix is folded; the displayed relative suffix retains its original case. Added regressions for mismatched casing, exact home, UNC paths, different drives/shares, near-prefix directories, and POSIX case differences. |
| Documentation should describe a retained xterm-session fallback | False positive. The dependency manifest and lockfile contain no xterm packages. Backend selection and surface replacement only use Ghostty WebGPU/WebGL, followed by a visible retryable display error. Existing import/dependency tests guard removal. Remaining xterm names describe protocol compatibility, discarded old preferences, or renderer attribution and licensing. The Ghostty-only architecture summary remains correct. |
| Close platform and offline-install validation gates | The evidence gap is valid, but cannot be closed by changing prose. Clarified the existing macOS 13 deployment target, Windows WebView2 network/offline prerequisites, and Linux dependencies. These settings also exist on merged main. Packaged GUI, old-webview, and installer scenarios remain explicitly unverified; no support minimum or installer mode was changed. |

The reviewed head passed all test/build/coverage CI jobs, including Rust on
Linux, macOS, and Windows and terminal tests on macOS and Windows:
[CI run 34116210880](https://github.com/crynta/terax-ai/actions/runs/34116210880).
No PR replies were posted or review threads resolved automatically.

Validation of this follow-up: 165 frontend files / 1,148 tests, TypeScript via
the production build, lint, and all five asset budgets pass. The changed path
files also pass Biome formatting/import checks. The existing 89 lint warnings
and one info remain. Rust, WASM, renderer, and installer code are unchanged;
their current CI evidence is the reviewed head above.
