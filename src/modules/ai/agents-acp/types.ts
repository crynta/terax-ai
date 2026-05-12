/**
 * Wire shapes for the ACP agents subsystem.
 *
 * Mirrors `src-tauri/src/modules/agents/event.rs` and the Rust commands —
 * if you add a variant on one side you almost always need to add it on the
 * other. Keep this file the single TypeScript source of truth so the
 * transport layer doesn't reach into Tauri command results directly.
 */

export type BackendKind = "acp-shim" | "acp-native" | (string & {});

export type BackendId = "claude-code" | "codex" | "gemini";

/** Minimum the Settings UI needs to render the External Agents section. */
export type BackendStatus = {
  id: BackendId | string;
  label: string;
  kind: BackendKind;
  binaryPath: string | null;
  installHint: string;
  authHint: string;
  docsUrl: string;
  authEnvs: AuthEnvDescriptor[];
};

/** One auth-env entry per backend — drives a Settings field. */
export type AuthEnvDescriptor = {
  /** Keychain account under `terax-ai` service. */
  account: string;
  /** Env var the spawned process will see. Surfaced in the probe panel. */
  envName: string;
  label: string;
  hint: string;
};

export type ToolCallContentPart =
  | { kind: "content"; text: string; mimeType?: string | null }
  | {
      kind: "diff";
      path: string;
      oldText: string | null;
      newText: string;
    }
  | { kind: "terminal"; terminalId: string };

export type ToolCallLocation = { path: string; line?: number | null };

export type ToolCallSnapshot = {
  id: string;
  title: string;
  kind: string;
  status: string;
  content: ToolCallContentPart[];
  locations: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
};

export type PermissionOption = {
  id: string;
  label: string;
  kind: string;
};

export type PlanEntry = {
  content: string;
  priority: string;
  status: string;
};

/**
 * Discriminated union matching `AgentEvent` on the Rust side. Tauri's
 * `serde(tag = "type", rename_all = "snake_case")` produces the lowercase
 * snake-case `type` discriminator we destructure on.
 */
export type AgentEvent =
  | {
      type: "session_ready";
      session_id: string;
      protocol_version: number;
      agent_name: string | null;
      agent_version: string | null;
    }
  | {
      type: "assistant_chunk";
      session_id: string;
      text: string;
    }
  | {
      type: "reasoning_chunk";
      session_id: string;
      text: string;
    }
  | {
      type: "tool_call";
      session_id: string;
      call: RawToolCallSnapshot;
    }
  | {
      type: "tool_call_update";
      session_id: string;
      call_id: string;
      status: string | null;
      title: string | null;
      content: RawToolCallContentPart[] | null;
      locations: RawToolCallLocation[] | null;
      raw_output: unknown;
    }
  | {
      type: "plan";
      session_id: string;
      entries: PlanEntry[];
    }
  | {
      type: "permission_request";
      session_id: string;
      request_id: string;
      tool_call: RawToolCallSnapshot;
      options: PermissionOption[];
    }
  | {
      type: "turn_ended";
      session_id: string;
      stop_reason: string;
    }
  | {
      type: "error";
      session_id: string;
      message: string;
    }
  | {
      type: "closed";
      session_id: string;
    };

// ----- raw-from-Rust shapes (snake_case on the wire) -----

type RawToolCallSnapshot = {
  id: string;
  title: string;
  kind: string;
  status: string;
  content: RawToolCallContentPart[];
  locations: RawToolCallLocation[];
  raw_input?: unknown;
  raw_output?: unknown;
};

type RawToolCallContentPart =
  | { kind: "content"; text: string; mime_type: string | null }
  | {
      kind: "diff";
      path: string;
      old_text: string | null;
      new_text: string;
    }
  | { kind: "terminal"; terminal_id: string };

type RawToolCallLocation = { path: string; line?: number | null };

// ----- normalizers (raw → camelCase) -----

export function normalizeToolCall(raw: RawToolCallSnapshot): ToolCallSnapshot {
  return {
    id: raw.id,
    title: raw.title,
    kind: raw.kind,
    status: raw.status,
    content: raw.content.map(normalizeToolCallContent),
    locations: raw.locations.map((l) => ({ path: l.path, line: l.line })),
    rawInput: raw.raw_input,
    rawOutput: raw.raw_output,
  };
}

export function normalizeToolCallContent(
  raw: RawToolCallContentPart,
): ToolCallContentPart {
  switch (raw.kind) {
    case "content":
      return { kind: "content", text: raw.text, mimeType: raw.mime_type };
    case "diff":
      return {
        kind: "diff",
        path: raw.path,
        oldText: raw.old_text,
        newText: raw.new_text,
      };
    case "terminal":
      return { kind: "terminal", terminalId: raw.terminal_id };
  }
}
