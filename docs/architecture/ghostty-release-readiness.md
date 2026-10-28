# Release readiness

Gates for shipping the libghostty + WebGPU terminal (0.9.0). Automated checks
alone do not establish platform parity or multi-day stability; the manual gates
below do.

## Verified on macOS (M4, macOS 26)

- Frontend: lint (no new warnings), types, all vitest suites, production build,
  size budgets, startup-graph check (`pnpm check:dist`), React Compiler health.
- Rust: clippy `-D warnings`, nextest (incl. live FSEvents and PTY tests),
  Windows cross-check (`--target x86_64-pc-windows-gnu`).
- Real-app benchmarks (`pnpm profile:app`): tab switching, window and divider
  drags, occlusion, steady agents, idle, file churn, keyboard/IME input injection.
- Real transport (`scripts/pty-smoke`): echo, exit ordering, 16 MiB floods,
  keepalive, reload, origin/token admission.
- Pixel checks (`scripts/terminal-visual`): renderer v1/v2 parity at ratio 2,
  crisp text at 1.25/1.5, splits, procedural glyph seams, WebGPU/WebGL parity.

## Open gates

| Gate | Needed |
| --- | --- |
| Windows (WebView2, ConPTY) | Installer, text crispness at 125/150 %, contrast defaults, `terax-pty` long-poll, IME, AltGr, pwsh/cmd/WSL, resize behaviour (burst heuristic, no native live-resize signal). |
| Linux (WebKitGTK 4.1) | Package install, WebGPU or WebGL path, `terax-pty` POST bodies, IME, resize. |
| Long sessions | A multi-hour daily-use run with agents on the release build; memory must return to its floor after tab switches, drags and occlusion. |
| Accessibility | VoiceOver smoke test (the terminal input holds a selected placeholder character). |
| Updater | Signed release artifacts and update from the previous beta. |

## Platform configuration

- macOS minimum is 13.0 (Tauri config); the scalar WASM artifact covers webviews
  without SIMD. A packaged run on macOS 13 is still worth doing.
- Windows uses a per-user NSIS installer with `downloadBootstrapper` (no bundled
  WebView2 runtime); offline installs need the runtime provisioned beforehand. No
  `minimumWebview2Version` is set.
- Linux packages declare WebKitGTK 4.1 and GTK 3.
- Kitty graphics is incomplete and must not be advertised.
