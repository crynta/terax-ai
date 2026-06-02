use serde::Serialize;

/// A registered coding agent that Terax can detect, notify about, and wrap.
#[derive(Debug, Clone, Serialize)]
pub struct AgentRegistration {
    /// Unique id matching the OSC 777 marker (e.g. "opencode", "claude").
    pub id: &'static str,
    /// Human-readable label for UI (e.g. "OpenCode", "Claude Code").
    pub name: &'static str,
    /// Binary names to detect in shell preexec (primary first).
    pub bins: &'static [&'static str],
    /// True if this agent has a native hooks config file Terax can write to.
    pub has_native_hooks: bool,
    /// Path to hooks config file, relative to $HOME (e.g. ".claude/settings.json").
    pub hook_config_path: Option<&'static str>,
    /// Embedded logo: inline SVG string or data:image/png;base64,... URL.
    pub logo: &'static str,
    /// OSC 777 command to emit before running the agent (shell wrapper pre).
    pub wrapper_pre_cmd: Option<&'static str>,
    /// OSC 777 command to emit after running the agent (shell wrapper post).
    pub wrapper_post_cmd: Option<&'static str>,
}

impl AgentRegistration {
    /// The primary binary (first in `bins`), used for shell wrapper generation.
    pub fn primary_bin(&self) -> &'static str {
        self.bins.first().copied().unwrap_or(self.id)
    }

    /// Whether this agent should get a shell wrapper instead of native hooks.
    pub fn needs_wrapper(&self) -> bool {
        !self.has_native_hooks
    }

    /// Agent ids that have native hooks config files.
    pub fn native_hook_ids() -> &'static [&'static str] {
        &["claude", "codex"]
    }
}

// Pre-computed data URLs for the 3 PNG logos (SVGs are embedded inline).
const LOGO_AIDER: &str = "data:image/png;base64,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";
const LOGO_DEVIN: &str = "data:image/png;base64,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";
const LOGO_TRAECLI: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAI3UlEQVR42u2da2xbZxnHf/9jJ07S2GkbBqqTNFvHGEwqG5vWovUyWDuG9oGr2MQXEPBhQ4IPTEjjJthYEXRiX5CmrhpX8RHRdSC0VQjKurZb0zJNFR29DNZuabOOKgw7tZ3EPg8fju051zpx7HMcn5+UKJLPefK+z//1c573dl6xCJLJAYAoMAhsAG4DuwkYNFgNdEpyFmM7qJiZARlgFDgrdBzskMEQcE6Qv3BheMF2Ve2F/X19FMxBsjimLcBnwbYAa4EYqtrU8sAAbNzgdcEBxB7goKFUBJfh8+erMlOV15J9/WB0Ie4CvoppE6LLbx8EC8sCB4EnMJ41yOx9LMfGz1+a9655BUj2DZCeyBFvi60HvoX4FCh0/LxYBmOvwY97290ToxOOzReaInN9UIrzsUjkHmA34nZQm9/VCz5qM1gP3Jkr6D8Gp+LxhDuWTs169awCJPv6QXQivgF6FGnNAh4XLY8kJPUCHxMUgGPxeCI/mwgzBEgm+wE6gO8hvou0wu8KNS1SzGALXsb4wmwiTBFgTbIfQRTxAOLboA6/69DsSIoCGwVZwZHuaeGoLEAy2Y+8VPJeg50KW/6SISlqcCvwmqR/dMcTlESIQDHseCF+PbBLUtLvQi83JHUAHwSeAy52r0gwNpbC6616zu8EHkRc53dhlzHXAQ8CXaVxgkh/fz+ugcQngO+EqWb9KIb4a4HjwMmVPQmcovMTwH1hJ6v+SOqSuF8i7ho4ZgBsLv6ENAAzNpux1Qwcx1EE+AyEYzuNQlIX6NOgSNSMq0FbzQtFIY1CthW4JorZBtBA6PwGYwwAt0YRm/CGHkIaSwdwm4PXOQhpMMWU9CYHb1oxxB8GHaDX71K0LGK1Q5h++ofR6YTJp39IcpbV0pFmJFqrATMrLtFoQVTOZhZNTQKYGU48htPTmt0I9+0s7thETSLU9g1wjY6730f3fRvAbbGvgUT6Z4fJ7nkFon4JYOB0x4j0JVpSAGdFe81man4GYAYurfccsKWpcJgF+UwogM+EAvhMKIDP1P4QvgJm5uXJzTbiYfZO2etI3QWQhPu/HO7buXr/qyXFWdWJk4jV/f/UXQAckf3jSS4/eRSaYujJG1rp/tqH6bpnfd37N/UXQGCXJyiMpCHSDALghZ/Lkw1ZkV9/AUo48h4DAX8WeHvx1LDtEE3SJJcvoQA+07gQtFjMysNMtaSEVjF2U+/UciEE/htgBopFi38vMiMp3qeOGu3UgUALYAWX6LpV9OzYTmzL1eDawp1nhrlG2/uvYuVP7iJ229rF2akTgRXACi7Ra1bT89A2Oj95A4nv37FwESqcn3h4Gx13X0/iB3cESoRAClB2/g+30b5xAPIu0YEeEg9tq16ESuc/sp32G9d4dgZXkXh4W2BECJwAM5zvmufMwgJEmM35rtfDtUKwRAiUALM7H/A2PlctwqzOh/IqhiCJEAwBii02+t5eeh6Z7vx3LqsUoeehbcRuv6Z4u02x03bDu+nZceeUll/JVBG2E9s8ONVOAwmEAFb83X5zkrabkuWh4NmGAwTgGpG1PXR8dB2KOtPsQPstfUQ/cNU7LXseO9HBlcQ+sg75NE4VCAFK8wXZP53i8i+PYRMFr5VOb5GlbTyC3L4zjO0ewibdcsdKxc+ye06Q+fVLWN69sp1nTnP5yaPlaxtNIASAYljITDK2a4jLv/o7NjlNhEqn/flVUjv2UxhJI0cz7LiZSdKPv0jmN7OIUGnn2TOkfvQ3ChfHZthpFIEaipAjLJdnbNcQGKz48i2oLVIxq1bh/DfH5gwbcoRl86QffxGAri/ejKLOVDsl57815lv4gYAJABUiPDEEghVfugW1e6+0qMb5U+xMF6HNuycozocACgDTvgl4IowfOFu186fYqRThCx9ifP+/A+N8CKgAUCHC7qPkXx1l4tj5BTl/ip2sJ+bk6UtMHBkOjPMhwAJAyXmTZP/wT68ztkinyRFuZoLs07XZqQeBFgCKqaUDtc4Rlu0EaC4AmkAAYOmcFjDnQ4D6Aa1KKIDP1B6CJIjI2yMwG05xiYdr5TGfwGMs2fr/K1GbAAL3v1nypy7NOZIoR96g1/XvCtRk+HyYeUsTG9FWahPAEdlnTjP+3GtzFtZco+ve9fT+9nNYs2xjMnBWtDVk21VNAkhenl7ITM59UcGLTU5vV3PtIzOaY3V0aXBrznq4KleoGcL/jLrVmTAL8plQAJ8JBfCZUACfacxYkPA6a8uJJdrr0JAdMu6lDJOvvNVcaWgVFXNHszVv5FCyb6CuXjEz1BFFHcvvldSWncTG8z6+LaUKJG9my3L5hjqnUfj6vqBGFXI544C5tZsJWQyGmYMp63dBWhYj4yBG/S5H66JRBzjndzFaFzvrAC/7XYzWRccdzA5j1lxv0lgGmFkO7JBjcNTgDb8L1IK8AQw54L4GHPC7NK2HDoDOOsgpSDwFlvG7SK2CmWWAPcgKjjf3yQEzDvpdsBbiINhBSsdYSaSBJ8JvQf0ptv7dklJm4Lw54p32LLEPY2+zTZw3IU8Bz5gZb44Ml2bEhJkyoJ1gZ/wu4XLFzM4AO4GsihMJEYB0OkUikcDQRYlLwPbwLOGlxcxSwDcl/gJi5IKX+ZfPEy6JAJw0U0GwBTXJ8vWAY0YOtAP4OeCOXBgufzblRO10OkU8nnBBLwmiBhsVilAr4xKPAY+CJiqdD7OcKe+J0JMHXgBykm0A1f8FmssQw1KYHgF+CuRKYaeSyGw3jqVTxBOJvMQRM/4F3CjU26g3CS4HzOxV4AHgF8CMll8iMpeBsXSK7niPO55qPxGNufvBVgLXSuGBz/NhXl/qd4ivW6ztryq47lzOh6oWVXyFZHIfQJfBx4H7gc2SOv2ubJAwLINxCNglsc8gM3J++Ir3VR1U3pPsI4KDYQlgs7wziLcirQVa9Blh48DrBs8Dv8d4XiJdMOPihfNVWVhUVF+T7EcoCjZoYoNgE96hoFcDq4GuQG5JrAlzQVmMUbBzSC+DHQaGDDuHkR+p0umV/B8h5MicAJokHAAAAABJRU5ErkJggg==";

/// All 22 registered agents. Adding a new agent = one row here.
/// Everything else (OSC detection, shell wrappers, notification bell, status bar)
/// derives from this array.
pub const AGENT_REGISTRY: &[AgentRegistration] = &[
    AgentRegistration { id: "aider", name: "Aider", bins: &["aider"], has_native_hooks: false, hook_config_path: None, logo: LOGO_AIDER, wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;aider;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;aider;finished\007'"#) },
    AgentRegistration { id: "amr", name: "AMR", bins: &["vela"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/amr.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;amr;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;amr;finished\007'"#) },
    AgentRegistration { id: "antigravity", name: "Antigravity", bins: &["agy"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/antigravity.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;antigravity;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;antigravity;finished\007'"#) },
    AgentRegistration { id: "claude", name: "Claude Code", bins: &["claude", "openclaude"], has_native_hooks: true, hook_config_path: Some(".claude/settings.json"), logo: include_str!("../../../logos/claude.svg"), wrapper_pre_cmd: None, wrapper_post_cmd: None },
    AgentRegistration { id: "codex", name: "Codex CLI", bins: &["codex"], has_native_hooks: true, hook_config_path: Some(".codex/hooks.json"), logo: include_str!("../../../logos/codex.svg"), wrapper_pre_cmd: None, wrapper_post_cmd: None },
    AgentRegistration { id: "copilot", name: "GitHub Copilot CLI", bins: &["copilot"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/copilot.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;copilot;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;copilot;finished\007'"#) },
    AgentRegistration { id: "cursor-agent", name: "Cursor Agent", bins: &["cursor-agent"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/cursor-agent.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;cursor-agent;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;cursor-agent;finished\007'"#) },
    AgentRegistration { id: "deepseek", name: "DeepSeek TUI", bins: &["deepseek", "codewhale"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/deepseek.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;deepseek;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;deepseek;finished\007'"#) },
    AgentRegistration { id: "devin", name: "Devin for Terminal", bins: &["devin"], has_native_hooks: false, hook_config_path: None, logo: LOGO_DEVIN, wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;devin;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;devin;finished\007'"#) },
    AgentRegistration { id: "gemini", name: "Gemini CLI", bins: &["gemini"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/gemini.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;gemini;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;gemini;finished\007'"#) },
    AgentRegistration { id: "grok-build", name: "Grok Build", bins: &["grok"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/grok-build.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;grok-build;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;grok-build;finished\007'"#) },
    AgentRegistration { id: "hermes", name: "Hermes", bins: &["hermes"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/hermes.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;hermes;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;hermes;finished\007'"#) },
    AgentRegistration { id: "kilo", name: "Kilo", bins: &["kilo"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/kilo.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;kilo;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;kilo;finished\007'"#) },
    AgentRegistration { id: "kimi", name: "Kimi CLI", bins: &["kimi"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/kimi.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;kimi;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;kimi;finished\007'"#) },
    AgentRegistration { id: "kiro", name: "Kiro CLI", bins: &["kiro-cli"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/kiro.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;kiro;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;kiro;finished\007'"#) },
    AgentRegistration { id: "opencode", name: "OpenCode", bins: &["opencode-cli", "opencode"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/opencode.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;opencode;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;opencode;finished\007'"#) },
    AgentRegistration { id: "pi", name: "Pi", bins: &["pi"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/pi.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;pi;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;pi;finished\007'"#) },
    AgentRegistration { id: "qoder", name: "Qoder CLI", bins: &["qodercli"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/qoder.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;qoder;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;qoder;finished\007'"#) },
    AgentRegistration { id: "qwen", name: "Qwen Code", bins: &["qwen"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/qwen.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;qwen;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;qwen;finished\007'"#) },
    AgentRegistration { id: "reasonix", name: "DeepSeek Reasonix", bins: &["reasonix", "dsnix"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/reasonix.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;reasonix;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;reasonix;finished\007'"#) },
    AgentRegistration { id: "trae-cli", name: "Trae CLI", bins: &["traecli"], has_native_hooks: false, hook_config_path: None, logo: LOGO_TRAECLI, wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;trae-cli;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;trae-cli;finished\007'"#) },
    AgentRegistration { id: "vibe", name: "Mistral Vibe CLI", bins: &["vibe-acp"], has_native_hooks: false, hook_config_path: None, logo: include_str!("../../../logos/vibe.svg"), wrapper_pre_cmd: Some(r#"printf '\033]777;notify;Terax;vibe;working\007'"#), wrapper_post_cmd: Some(r#"printf '\033]777;notify;Terax;vibe;finished\007'"#) },
];

/// Look up an agent by its id. Returns None for unknown ids.
pub fn get_agent(id: &str) -> Option<&'static AgentRegistration> {
    AGENT_REGISTRY.iter().find(|a| a.id == id)
}

/// Return the default agent id (backward compat for legacy OSC 777).
pub fn default_agent_id() -> &'static str {
    "claude"
}

/// All binary names that should trigger OSC 133;C agent detection.
pub fn all_agent_bins() -> Vec<&'static str> {
    let mut bins: Vec<&str> = Vec::with_capacity(32);
    for a in AGENT_REGISTRY {
        for b in a.bins {
            if !bins.contains(b) {
                bins.push(b);
            }
        }
    }
    bins
}

/// Agents that need shell wrappers (no native hooks).
pub fn wrapper_agents() -> Vec<&'static AgentRegistration> {
    AGENT_REGISTRY
        .iter()
        .filter(|a| a.needs_wrapper())
        .collect()
}

/// Shell types supported for wrapper generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Bash,
    Zsh,
    Fish,
    PowerShell,
}

impl ShellKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ShellKind::Bash => "bash",
            ShellKind::Zsh => "zsh",
            ShellKind::Fish => "fish",
            ShellKind::PowerShell => "powershell",
        }
    }
}

/// Generate shell wrapper functions for all agents that need them.
/// Returns a script snippet to be appended after user hooks are sourced,
/// so the wrappers take precedence over the real binaries.
pub fn generate_wrappers(shell: ShellKind) -> String {
    let agents = wrapper_agents();
    if agents.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    out.push_str("\n# Terax agent wrappers (auto-generated from registry)\n");

    for agent in &agents {
        let bin = agent.primary_bin();
        let id = agent.id;
        let pre = agent.wrapper_pre_cmd.unwrap_or("");
        let post = agent.wrapper_post_cmd.unwrap_or("");
        match shell {
            ShellKind::Bash | ShellKind::Zsh => {
                out.push_str(&format!(
                    r#"{bin}() {{
  {pre}
  command {bin} "$@"
  local _rc=$?
  {post}
  return $_rc
}}

"#));
            }
            ShellKind::Fish => {
                out.push_str(&format!(
                    r#"function {bin}
  {pre}
  command {bin} $argv
  set -l _rc $status
  {post}
  return $_rc
end

"#));
            }
            ShellKind::PowerShell => {
                out.push_str(&format!(
                    r#"function global:{bin} {{
  $prev = $global:?
  try {{
    & {bin} @args
  }} finally {{
    $host.ui.Write("`e]777;notify;Terax;{id};finished`a")
  }}
}}

"#));
            }
        }
    }
    out
}

/// Append agent wrappers to a shell init script file.
/// Wrappers go AFTER user hooks so they take precedence.
pub fn append_wrappers_to_script(path: &std::path::Path, shell: ShellKind) -> Result<(), String> {
    let content = generate_wrappers(shell);
    if content.is_empty() {
        return Ok(());
    }
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut final_content = existing;
    final_content.push_str(&content);
    // Use the same atomic-write pattern as shell_init's write_if_changed.
    let tmp = path.with_extension("tmp.terax");
    std::fs::write(&tmp, &final_content)
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename into {}: {e}", path.display())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_agents_have_unique_ids() {
        let mut ids = std::collections::HashSet::new();
        for a in AGENT_REGISTRY {
            assert!(ids.insert(a.id), "duplicate id: {}", a.id);
        }
    }

    #[test]
    fn all_agents_have_at_least_one_bin() {
        for a in AGENT_REGISTRY {
            assert!(!a.bins.is_empty(), "agent {} has no bins", a.id);
        }
    }

    #[test]
    fn get_agent_finds_every_entry() {
        for a in AGENT_REGISTRY {
            assert_eq!(get_agent(a.id).unwrap().id, a.id);
        }
    }

    #[test]
    fn get_agent_unknown_returns_none() {
        assert!(get_agent("nonexistent-agent").is_none());
    }

    #[test]
    fn native_hook_agents_have_config_path() {
        for id in AgentRegistration::native_hook_ids() {
            let a = get_agent(id).unwrap();
            assert!(a.hook_config_path.is_some(),
                "agent {} has native hooks but no config path", id);
        }
    }

    #[test]
    fn wrapper_agents_have_pre_and_post_cmds() {
        for a in wrapper_agents() {
            assert!(a.wrapper_pre_cmd.is_some(),
                "agent {} needs wrapper but no pre_cmd", a.id);
            assert!(a.wrapper_post_cmd.is_some(),
                "agent {} needs wrapper but no post_cmd", a.id);
        }
    }

    #[test]
    fn all_agent_bins_includes_every_bin() {
        let bins = all_agent_bins();
        for a in AGENT_REGISTRY {
            for b in a.bins {
                assert!(bins.contains(b), "bin {} not in all_agent_bins", b);
            }
        }
    }

    #[test]
    fn default_agent_id_is_claude() {
        assert_eq!(default_agent_id(), "claude");
    }

    #[test]
    fn count_agents() {
        assert_eq!(AGENT_REGISTRY.len(), 22);
    }

    #[test]
    fn logo_is_non_empty() {
        for a in AGENT_REGISTRY {
            assert!(!a.logo.is_empty(), "agent {} has empty logo", a.id);
        }
    }

    #[test]
    fn cross_checks_total() {
        let native = AgentRegistration::native_hook_ids();
        let wrappers = wrapper_agents();
        assert_eq!(native.len() + wrappers.len(), AGENT_REGISTRY.len());
    }
}
