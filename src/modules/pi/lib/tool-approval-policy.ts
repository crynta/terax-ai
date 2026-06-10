/**
 * Tool-approval policy resolution for the webview Pi agent.
 *
 * The Rust capability manifest (src-tauri/.../capabilities) is the single
 * authority for whether a tool runs automatically (`auto`), requires user
 * approval (`ask`), or is blocked (`deny`). The sidecar consulted it; the
 * webview path consults it here instead of a hardcoded list, which keeps native
 * policy in sync and — crucially — applies the real policy to MCP tools so an
 * MCP tool marked `ask` is no longer auto-executed.
 *
 * Native tools are named differently on each side (the manifest uses `bash`,
 * the webview agent exposes `bash_run`), so we translate. Built-in defaults act
 * as a safe fallback when the manifest can't be fetched; the manifest overlays
 * them as the authority when present.
 */

export type ApprovalPolicy = "auto" | "ask" | "deny";

export type CapabilityTool = {
  name: string;
  approval: ApprovalPolicy;
  modelVisible?: boolean;
};

export type CapabilityManifest = {
  version: number;
  tools: CapabilityTool[];
};

/**
 * Safe defaults mirroring `core_capability_manifest` (Rust): mutating tools ask,
 * read-only tools auto. Keyed by the webview agent's tool names. Used when the
 * manifest is unavailable so native tools still behave correctly offline.
 */
const NATIVE_DEFAULT_POLICIES: Record<string, ApprovalPolicy> = {
  read_file: "auto",
  list_directory: "auto",
  grep: "auto",
  glob: "auto",
  bash_run: "ask",
  write_file: "ask",
  edit_file: "ask",
  // Interactive elicitation is a UI prompt, not an action — never gate it.
  ask_question: "auto",
};

/** Manifest (Rust core) tool name → webview agent tool name. */
const MANIFEST_TO_WEBVIEW_TOOL: Record<string, string> = {
  read: "read_file",
  ls: "list_directory",
  grep: "grep",
  find: "glob",
  bash: "bash_run",
  edit: "edit_file",
  write: "write_file",
};

/**
 * Build a map of (webview tool name → approval policy) from the capability
 * manifest, starting from the native defaults and overlaying the manifest as
 * the authority. MCP tools are keyed by their qualified name, which matches the
 * webview tool name directly.
 */
export function buildToolApprovalPolicies(
  manifest: CapabilityManifest | undefined | null,
): Map<string, ApprovalPolicy> {
  const policies = new Map<string, ApprovalPolicy>(
    Object.entries(NATIVE_DEFAULT_POLICIES),
  );

  if (manifest && Array.isArray(manifest.tools)) {
    for (const tool of manifest.tools) {
      if (!tool || typeof tool.name !== "string") continue;
      const webviewName = MANIFEST_TO_WEBVIEW_TOOL[tool.name] ?? tool.name;
      policies.set(webviewName, tool.approval);
    }
  }

  return policies;
}

/**
 * Resolve a tool's approval policy. Unknown tools default to `ask` so an
 * unexpected tool prompts rather than running unattended.
 */
export function resolveToolApproval(
  toolName: string,
  policies: Map<string, ApprovalPolicy>,
): ApprovalPolicy {
  return policies.get(toolName) ?? "ask";
}
