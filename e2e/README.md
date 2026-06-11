# End-to-end tests

These specs drive the real, packaged Terax binary through
[WebdriverIO](https://webdriver.io/) and
[`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/), exercising the
native WebView the way a user would.

## Platform support

`tauri-driver` bridges WebDriver to the platform WebView driver. That driver
exists on **Linux** (WebKitWebDriver) and **Windows** (Edge WebDriver) only.
**There is no WebDriver for WKWebView on macOS**, so these tests cannot run on
the macOS dev machine. They run in CI on Linux (see `.github/workflows/ci.yml`,
job `e2e`).

Authoring on macOS is fine: the spec files live outside `./src`, so they are
not type-checked or linted by the frontend toolchain, and CI is the source of
truth for execution.

## What is covered

Golden flows that need no AI provider, secrets, or network:

- `smoke.e2e.mjs` - the app boots, the React root renders, the window title is
  `Terax`, and the tab bar plus a terminal pane mount on first launch.
- `tabs.e2e.mjs` - opening a terminal tab from the new-tab menu increases the
  tab count; closing a tab decreases it.
- `terminal.e2e.mjs` - a PTY-backed xterm mounts, accepts keystrokes through
  its helper textarea, and the UI stays responsive after a command.

xterm renders to a WebGL canvas, so on-screen terminal text is not readable
through the DOM. The terminal spec asserts the input plumbing structurally
rather than scraping rendered output.

## Running locally (Linux)

```sh
# one-time: the WebDriver bridge and the WebKit driver
cargo install tauri-driver --locked
sudo apt-get install -y webkit2gtk-driver xvfb

# build the frontend and the release binary the driver will launch
pnpm install
pnpm build
cargo build --release --manifest-path src-tauri/Cargo.toml

# run the specs (headless)
xvfb-run -a pnpm e2e
```

`pnpm e2e` runs `wdio run ./wdio.conf.mjs`. The config spawns `tauri-driver`
itself and points the session at `src-tauri/target/release/terax`.

## Adding a spec

1. Add `e2e/specs/<name>.e2e.mjs` (the `.e2e.mjs` suffix is required by the
   `specs` glob in `wdio.conf.mjs`).
2. Prefer stable `data-testid` hooks over class names. Existing hooks:
   `tab-bar`, `new-tab-button`, `new-tab-terminal`, `terminal-pane`,
   `cwd-breadcrumb`.
3. Keep specs free of AI providers, secrets, and network so they stay
   deterministic in CI.
