import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { previewLabel } from "./previewBridge";

/**
 * The web preview renders in a native child webview (see
 * src-tauri/src/modules/preview.rs). Its security model is: the webview is
 * given NO Tauri capability, so the embedded page can't reach the IPC /
 * `window.__TAURI__` surface. Capabilities target webviews by label (with glob
 * support), so if a capability ever lists `*` or a `preview-*` pattern, the
 * embedded page would gain IPC access. This test locks that invariant.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const capsDir = path.join(here, "../../../src-tauri/capabilities");

/** Minimal glob match for Tauri window-label patterns (only `*` is used). */
function labelMatches(pattern: string, label: string): boolean {
  const re = new RegExp(
    `^${pattern.split("*").map(escapeRegExp).join(".*")}$`,
  );
  return re.test(label);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capabilityWindowPatterns(): string[] {
  const files = readdirSync(capsDir).filter((f) => f.endsWith(".json"));
  const patterns: string[] = [];
  for (const f of files) {
    const json = JSON.parse(readFileSync(path.join(capsDir, f), "utf8"));
    if (Array.isArray(json.windows)) patterns.push(...json.windows);
  }
  return patterns;
}

describe("previewLabel", () => {
  it("is a stable, per-id label", () => {
    expect(previewLabel(0)).toBe("preview-0");
    expect(previewLabel(42)).toBe("preview-42");
  });
});

describe("preview webview capabilities", () => {
  it("no capability grants the preview webview Tauri/IPC access", () => {
    const patterns = capabilityWindowPatterns();
    // Sanity: we actually parsed real capability files.
    expect(patterns.length).toBeGreaterThan(0);

    const sampleLabels = [previewLabel(0), previewLabel(7), previewLabel(123)];
    for (const pattern of patterns) {
      for (const label of sampleLabels) {
        expect(
          labelMatches(pattern, label),
          `capability window pattern "${pattern}" must not match preview label "${label}"`,
        ).toBe(false);
      }
    }
  });
});
