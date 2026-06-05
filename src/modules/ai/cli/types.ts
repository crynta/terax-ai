export type CliAgentId = "claude" | "codex" | "cursor" | "opencode";

/** Mirror of the Rust `AgentCliEvent` (serde tag = "kind", camelCase). */
export type CliSpawnEvent =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null }
  | { kind: "error"; message: string };

/** Permission posture passed to the wrapped CLI. CLIs run headless so they
 *  cannot prompt; we choose a non-interactive policy up front. */
export type CliPermissionMode = "default" | "acceptEdits" | "full";
