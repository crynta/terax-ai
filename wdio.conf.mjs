/**
 * WebdriverIO configuration for Terax end-to-end tests.
 *
 * The app is driven through `tauri-driver`, which bridges WebDriver to the
 * platform WebView (WebKitWebDriver on Linux, Edge WebDriver on Windows).
 *
 * IMPORTANT: `tauri-driver` supports Linux and Windows only. There is no macOS
 * WebDriver for WKWebView, so these specs run in CI (Linux) and on Windows,
 * not on the macOS dev machine. See e2e/README.md.
 *
 * Prerequisites (handled by CI, see .github/workflows/ci.yml):
 *   - `cargo install tauri-driver --locked`
 *   - the release binary built at src-tauri/target/release/terax
 *   - Linux: WebKitWebDriver on PATH (webkit2gtk driver package)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const binaryName = process.platform === "win32" ? "terax.exe" : "terax";
const application = resolve(
  __dirname,
  "src-tauri",
  "target",
  "release",
  binaryName,
);

let tauriDriver;

export const config = {
  hostname: "127.0.0.1",
  port: 4444,

  specs: ["./e2e/specs/**/*.e2e.mjs"],

  // tauri-driver mediates a single native WebView session at a time.
  maxInstances: 1,

  capabilities: [
    {
      "tauri:options": {
        application,
      },
    },
  ],

  logLevel: "warn",
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  /**
   * Ensure the release binary exists before the run. Building is the caller's
   * job in CI (so failures surface in a dedicated step), but a local Linux run
   * gets a clear error instead of a cryptic driver crash.
   */
  onPrepare() {
    if (!existsSync(application)) {
      throw new Error(
        `Terax release binary not found at ${application}.\n` +
          "Build it first: pnpm build && cargo build --release --manifest-path src-tauri/Cargo.toml",
      );
    }
  },

  /**
   * Start tauri-driver before the WebDriver session opens, kill it after.
   * tauri-driver listens on 4444 and forwards to the native WebView driver.
   */
  beforeSession() {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },

  afterSession() {
    if (tauriDriver) {
      tauriDriver.kill();
      tauriDriver = undefined;
    }
  },
};

// Surface a friendly message if tauri-driver is not installed at all.
if (process.env.WDIO_VERIFY_DRIVER === "1") {
  const probe = spawnSync("tauri-driver", ["--help"], { encoding: "utf8" });
  if (probe.error) {
    throw new Error(
      "tauri-driver is not installed. Install it with: cargo install tauri-driver --locked",
    );
  }
}
