/**
 * Tests for webview tool-approval policy resolution.
 *
 * The webview agent must decide which tools require human approval from the
 * Rust capability manifest (the single policy authority), not a hardcoded list.
 * This closes two gaps:
 *  - native policy can't silently diverge from the manifest, and
 *  - MCP tools marked "ask" are no longer auto-executed (the bypass).
 *
 * Built-in native defaults are used as a safe fallback when the manifest can't
 * be fetched, and the manifest overlays them as the authority when present.
 */
import { describe, expect, it } from "vitest";
import {
  buildToolApprovalPolicies,
  type CapabilityManifest,
  resolveToolApproval,
} from "./tool-approval-policy";

describe("buildToolApprovalPolicies", () => {
  it("falls back to safe native defaults when no manifest is available", () => {
    const policies = buildToolApprovalPolicies(undefined);
    // Mutating tools require approval; read-only tools do not.
    expect(policies.get("bash_run")).toBe("ask");
    expect(policies.get("write_file")).toBe("ask");
    expect(policies.get("edit_file")).toBe("ask");
    expect(policies.get("read_file")).toBe("auto");
    expect(policies.get("grep")).toBe("auto");
    expect(policies.get("list_directory")).toBe("auto");
  });

  it("lets the manifest override native defaults (authority wins)", () => {
    const manifest: CapabilityManifest = {
      version: 1,
      tools: [{ name: "bash", approval: "auto", modelVisible: true }],
    };
    // Manifest tool "bash" maps to the webview tool "bash_run".
    expect(buildToolApprovalPolicies(manifest).get("bash_run")).toBe("auto");
  });

  it("treats the interactive ask_question tool as auto (never gated)", () => {
    // ask_question is a UI prompt, not an action — gating it would double-prompt
    // or, worse, deny the question outright.
    expect(buildToolApprovalPolicies(undefined).get("ask_question")).toBe(
      "auto",
    );
  });

  it("includes MCP tools keyed by their qualified name", () => {
    const manifest: CapabilityManifest = {
      version: 1,
      tools: [
        { name: "mcp__server__dangerous", approval: "ask", modelVisible: true },
        { name: "mcp__server__safe", approval: "auto", modelVisible: true },
      ],
    };
    const policies = buildToolApprovalPolicies(manifest);
    expect(policies.get("mcp__server__dangerous")).toBe("ask");
    expect(policies.get("mcp__server__safe")).toBe("auto");
  });
});

describe("resolveToolApproval", () => {
  it("returns the tool's policy when known", () => {
    const policies = new Map([["bash_run", "ask" as const]]);
    expect(resolveToolApproval("bash_run", policies)).toBe("ask");
  });

  it("defaults unknown tools to ask (conservative)", () => {
    expect(resolveToolApproval("mystery_tool", new Map())).toBe("ask");
  });
});
