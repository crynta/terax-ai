//! Static registry of known external agent backends.
//!
//! Each entry is the minimum the rest of the system needs to spawn the
//! correct CLI, render install/auth hints, and emit a stable id back to the
//! frontend. New backends are added by appending to `BACKENDS` — `runtime.rs`
//! and `detection.rs` are backend-agnostic.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BackendId {
    ClaudeCode,
    Codex,
    Gemini,
}

/// Wire protocol used to drive a backend. Each variant maps to a driver
/// implementation under `runtime::`. The dispatch happens in
/// `runtime::start_session` so adding a non-ACP backend (e.g. Aider, which
/// emits unstructured stdout) is "add an enum variant + a driver module"
/// — the surrounding session-state, command channel, and `AgentEvent`
/// shape stay the same.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendProtocol {
    /// Spawn a CLI that already speaks the Agent Client Protocol — directly
    /// (Gemini's `--experimental-acp`) or via a shim (`claude-code-acp`,
    /// `codex-acp`).
    Acp,
}

impl BackendId {
    pub fn as_str(self) -> &'static str {
        match self {
            BackendId::ClaudeCode => "claude-code",
            BackendId::Codex => "codex",
            BackendId::Gemini => "gemini",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude-code" => Some(BackendId::ClaudeCode),
            "codex" => Some(BackendId::Codex),
            "gemini" => Some(BackendId::Gemini),
            _ => None,
        }
    }
}

pub struct AgentBackend {
    pub id: BackendId,
    pub label: &'static str,
    /// Wire protocol — selects the driver in `runtime::start_session`.
    pub protocol: BackendProtocol,
    /// Free-form classification surfaced to the UI ("acp-shim", "acp-native"
    /// today; could grow to "http-server", "stdio-jsonrpc" later).
    pub kind: &'static str,
    /// Which `$PATH` candidates to look for — first hit wins.
    pub binaries: &'static [&'static str],
    /// Default args passed to the spawned binary.
    pub args: &'static [&'static str],
    /// Auth env-vars to forward, in order. Each entry maps a keychain
    /// account (under `KEYRING_SERVICE`) to an env var on the spawned
    /// process. Entries with no keychain value are skipped silently —
    /// the agent then falls through to its own login flow.
    ///
    /// We forward ALL populated entries (not just the first), because the
    /// shim's auth chain decides precedence: e.g. Claude Code prefers
    /// `ANTHROPIC_API_KEY` over `CLAUDE_CODE_OAUTH_TOKEN` if both are set.
    pub auth_envs: &'static [AuthEnv],
    pub install_hint: &'static str,
    /// npm package name suitable for `npx -y …` as a fallback when the
    /// user hasn't globally installed the shim. Surfaced in the
    /// "binary not found" error so they can self-recover.
    pub npx_package: &'static str,
    pub auth_hint: &'static str,
    pub docs_url: &'static str,
}

pub struct AuthEnv {
    pub account: &'static str,
    pub env_name: &'static str,
    /// Human-readable label for the Settings UI ("API key", "OAuth token").
    pub label: &'static str,
    /// One-line UX hint shown next to the input. Free-form markdown-ish.
    pub hint: &'static str,
}

const BACKENDS: &[AgentBackend] = &[
    AgentBackend {
        id: BackendId::ClaudeCode,
        label: "Claude Code",
        protocol: BackendProtocol::Acp,
        kind: "acp-shim",
        binaries: &["claude-code-acp"],
        args: &[],
        // Two auth paths for Claude Code:
        // 1. API key (sk-ant-…) — pay per token via console.anthropic.com.
        // 2. OAuth token — mint via `claude setup-token` to use a Pro/Max
        //    subscription standalone. The token from `claude /login` alone
        //    is managed by Claude Desktop and 401s when used directly.
        auth_envs: &[
            AuthEnv {
                account: "anthropic-api-key",
                env_name: "ANTHROPIC_API_KEY",
                label: "API key",
                hint: "From console.anthropic.com — pay-per-token.",
            },
            AuthEnv {
                account: "claude-code-oauth-token",
                env_name: "CLAUDE_CODE_OAUTH_TOKEN",
                label: "OAuth token (Pro/Max subscription)",
                hint: "Run `claude setup-token` in a fresh terminal — paste the printed value here.",
            },
        ],
        install_hint: "npm i -g @zed-industries/claude-code-acp",
        npx_package: "@zed-industries/claude-code-acp",
        auth_hint:
            "Use an Anthropic API key for pay-per-token, or paste a `claude setup-token` OAuth value to drive your Pro/Max subscription.",
        docs_url: "https://github.com/zed-industries/claude-code-acp",
    },
    AgentBackend {
        id: BackendId::Codex,
        label: "OpenAI Codex CLI",
        protocol: BackendProtocol::Acp,
        kind: "acp-shim",
        binaries: &["codex-acp"],
        args: &[],
        auth_envs: &[AuthEnv {
            account: "openai-api-key",
            env_name: "OPENAI_API_KEY",
            label: "API key",
            hint: "From platform.openai.com.",
        }],
        install_hint: "npm i -g @zed-industries/codex-acp",
        npx_package: "@zed-industries/codex-acp",
        auth_hint:
            "Either set an OpenAI API key in Settings → AI, or run `codex login` once for ChatGPT auth.",
        docs_url: "https://github.com/zed-industries/codex-acp",
    },
    AgentBackend {
        id: BackendId::Gemini,
        label: "Gemini CLI",
        protocol: BackendProtocol::Acp,
        kind: "acp-native",
        binaries: &["gemini"],
        args: &["--experimental-acp"],
        auth_envs: &[AuthEnv {
            account: "google-api-key",
            env_name: "GEMINI_API_KEY",
            label: "API key",
            hint: "From aistudio.google.com/apikey.",
        }],
        install_hint: "npm i -g @google/gemini-cli",
        npx_package: "@google/gemini-cli",
        auth_hint:
            "Either set a Google AI API key in Settings → AI, or run `gemini` once and pick Google OAuth.",
        docs_url: "https://github.com/google-gemini/gemini-cli",
    },
];

pub fn all() -> &'static [AgentBackend] {
    BACKENDS
}

pub fn get(id: BackendId) -> &'static AgentBackend {
    BACKENDS
        .iter()
        .find(|b| b.id == id)
        .expect("BackendId variant must have a registry entry")
}

