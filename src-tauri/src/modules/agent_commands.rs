//! Lists the custom slash commands and skills Claude Code offers in a folder,
//! for the Session Reader composer's `/` autocomplete. Read-only: it walks
//! `~/.claude/commands`, `<cwd>/.claude/commands`, `~/.claude/skills`, the
//! installed plugins named in `~/.claude/plugins/installed_plugins.json` and
//! the synced plugins under `~/.claude/plugins/synced`, reading only each
//! file's front matter.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Most commands returned; the popup filters client-side.
const MAX_COMMANDS: usize = 600;
/// Bytes read from each command file to find its front matter.
const HEAD_BYTES: usize = 8 * 1024;
const DESCRIPTION_CAP: usize = 240;
/// Nested command folders deeper than this are ignored.
const MAX_DEPTH: usize = 4;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    /// What follows the `/`, e.g. `review`, `frontend:component`, `m-skills:pr`.
    pub name: String,
    pub description: String,
    /// `user`, `project`, `plugin` or `skill`.
    pub source: &'static str,
}

/// `name` and `description` from a Markdown file's leading `---` block; the
/// description falls back to the first line of body text.
fn front_matter(path: &Path) -> (Option<String>, Option<String>, bool) {
    let mut head = vec![0; HEAD_BYTES];
    let len = File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .unwrap_or(0);
    let text = String::from_utf8_lossy(&head[..len]);
    let mut lines = text.lines();
    let mut name = None;
    let mut description = None;
    let mut invocable = true;
    let mut body_start = 0;
    if lines.next().map(str::trim) == Some("---") {
        for (i, line) in lines.by_ref().enumerate() {
            let line = line.trim_end();
            if line.trim() == "---" {
                body_start = i + 2;
                break;
            }
            if let Some((key, value)) = line.split_once(':') {
                let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
                match key.trim() {
                    "name" if !value.is_empty() => name = Some(value.to_string()),
                    "description" if !value.is_empty() => description = Some(value.to_string()),
                    "user-invocable" => invocable = value != "false",
                    _ => {}
                }
            }
        }
    }
    if description.is_none() {
        description = text
            .lines()
            .skip(body_start)
            .map(|l| l.trim().trim_start_matches('#').trim())
            .find(|l| !l.is_empty() && *l != "---")
            .map(str::to_string);
    }
    (name, description.map(|d| cap(&d)), invocable)
}

fn cap(s: &str) -> String {
    if s.chars().count() <= DESCRIPTION_CAP {
        return s.to_string();
    }
    let cut: String = s.chars().take(DESCRIPTION_CAP).collect();
    format!("{}…", cut.trim_end())
}

/// Every `*.md` under `dir` (no symlinked folders), as `sub:dir:name` paths.
fn command_files(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<(String, PathBuf)>) {
    if depth > MAX_DEPTH || out.len() >= MAX_COMMANDS {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            let next = if prefix.is_empty() {
                name.to_string()
            } else {
                format!("{prefix}:{name}")
            };
            command_files(&path, &next, depth + 1, out);
        } else if kind.is_file() {
            if let Some(stem) = name.strip_suffix(".md") {
                let full = if prefix.is_empty() {
                    stem.to_string()
                } else {
                    format!("{prefix}:{stem}")
                };
                out.push((full, path));
            }
        }
    }
}

fn add_commands(
    dir: &Path,
    namespace: Option<&str>,
    source: &'static str,
    out: &mut Vec<CommandInfo>,
) {
    let mut files = Vec::new();
    command_files(dir, "", 0, &mut files);
    for (name, path) in files {
        let (_, description, _) = front_matter(&path);
        let name = match namespace {
            Some(ns) => format!("{ns}:{name}"),
            None => name,
        };
        out.push(CommandInfo {
            name,
            description: description.unwrap_or_default(),
            source,
        });
    }
}

/// Skills are folders holding a `SKILL.md`; ones marked
/// `user-invocable: false` are left out.
fn add_skills(dir: &Path, namespace: Option<&str>, out: &mut Vec<CommandInfo>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let skill = entry.path().join("SKILL.md");
        if !skill.is_file() {
            continue;
        }
        let (name, description, invocable) = front_matter(&skill);
        if !invocable {
            continue;
        }
        let name = name.unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
        let name = match namespace {
            Some(ns) => format!("{ns}:{name}"),
            None => name,
        };
        out.push(CommandInfo {
            name,
            description: description.unwrap_or_default(),
            source: "skill",
        });
    }
}

/// Install folders of plugins enabled for `cwd`: user-scoped ones, and
/// project-scoped ones whose project contains `cwd`.
fn installed_plugins(plugins_root: &Path, cwd: &Path) -> Vec<(String, PathBuf)> {
    let Ok(text) = std::fs::read_to_string(plugins_root.join("installed_plugins.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (key, installs) in plugins {
        let plugin = key.split('@').next().unwrap_or(key).to_string();
        for install in installs.as_array().into_iter().flatten() {
            let scope = install
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("user");
            let applies = match scope {
                "user" => true,
                _ => install
                    .get("projectPath")
                    .and_then(Value::as_str)
                    .is_some_and(|p| cwd.starts_with(p)),
            };
            if let Some(path) = install.get("installPath").and_then(Value::as_str) {
                let path = PathBuf::from(path);
                // Only folders inside the plugins tree are read.
                if applies && path.starts_with(plugins_root) {
                    out.push((plugin.clone(), path));
                    break;
                }
            }
        }
    }
    out
}

/// Plugins synced by an organisation: `synced/<id>/<plugin>/`.
fn synced_plugins(plugins_root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(groups) = std::fs::read_dir(plugins_root.join("synced")) else {
        return out;
    };
    for group in groups.flatten() {
        if !group.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(plugins) = std::fs::read_dir(group.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            if plugin.file_type().is_ok_and(|t| t.is_dir()) {
                out.push((
                    plugin.file_name().to_string_lossy().into_owned(),
                    plugin.path(),
                ));
            }
        }
    }
    out
}

fn list_in(claude_home: &Path, cwd: &Path) -> Vec<CommandInfo> {
    let mut out = Vec::new();
    if cwd.is_absolute() {
        add_commands(
            &cwd.join(".claude").join("commands"),
            None,
            "project",
            &mut out,
        );
    }
    add_commands(&claude_home.join("commands"), None, "user", &mut out);
    add_skills(&claude_home.join("skills"), None, &mut out);
    let plugins_root = claude_home.join("plugins");
    let mut plugins = installed_plugins(&plugins_root, cwd);
    plugins.extend(synced_plugins(&plugins_root));
    for (plugin, dir) in plugins {
        add_commands(&dir.join("commands"), Some(&plugin), "plugin", &mut out);
        add_skills(&dir.join("skills"), Some(&plugin), &mut out);
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert(c.name.clone()));
    out.truncate(MAX_COMMANDS);
    out
}

#[tauri::command]
pub async fn agent_list_commands(cwd: String) -> Result<Vec<CommandInfo>, String> {
    let home = dirs::home_dir().ok_or("could not resolve the home directory")?;
    super::fs::blocking(move || Ok(list_in(&home.join(".claude"), Path::new(&cwd)))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("terax-agent-commands-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn lists_project_user_skill_and_plugin_commands() {
        let root = temp_root("all");
        let home = root.join("home/.claude");
        let cwd = root.join("repo");
        write(
            &cwd.join(".claude/commands/deploy.md"),
            "---\ndescription: \"Ship the service\"\n---\nbody",
        );
        write(
            &cwd.join(".claude/commands/frontend/component.md"),
            "# Make a component\n",
        );
        write(
            &home.join("commands/standup.md"),
            "---\nmodel: x\n---\n\nWrite my standup\n",
        );
        write(
            &home.join("skills/etl-debug/SKILL.md"),
            "---\nname: etl-debug\ndescription: Debug an ETL pipeline\n---\n",
        );
        write(
            &home.join("skills/hidden/SKILL.md"),
            "---\nname: hidden\nuser-invocable: false\n---\n",
        );
        let install = home.join("plugins/cache/mkt/vercel/1.0");
        write(
            &install.join("commands/deploy.md"),
            "---\ndescription: Deploy to Vercel\n---\n",
        );
        write(
            &home.join("plugins/installed_plugins.json"),
            &serde_json::json!({"version": 2, "plugins": {
                "vercel@mkt": [{"scope": "user", "installPath": install}],
                "other@mkt": [{"scope": "project", "projectPath": "/elsewhere", "installPath": install}],
                "escape@mkt": [{"scope": "user", "installPath": "/etc"}]
            }})
            .to_string(),
        );
        write(
            &home.join("plugins/synced/org-1/m-skills/skills/pr/SKILL.md"),
            "---\nname: pr\ndescription: Raise a PR\n---\n",
        );

        let list = list_in(&home, &cwd);
        let find = |name: &str| list.iter().find(|c| c.name == name);
        assert_eq!(find("deploy").unwrap().description, "Ship the service");
        assert_eq!(find("deploy").unwrap().source, "project");
        assert_eq!(
            find("frontend:component").unwrap().description,
            "Make a component"
        );
        assert_eq!(find("standup").unwrap().description, "Write my standup");
        assert_eq!(find("etl-debug").unwrap().source, "skill");
        assert!(find("hidden").is_none(), "non-invocable skills are hidden");
        assert_eq!(find("vercel:deploy").unwrap().source, "plugin");
        assert!(
            find("other:deploy").is_none(),
            "project plugin for another folder"
        );
        assert!(list.iter().all(|c| !c.name.starts_with("escape:")));
        assert_eq!(find("m-skills:pr").unwrap().description, "Raise a PR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_folders_and_bad_json_yield_nothing() {
        let root = temp_root("empty");
        write(
            &root.join("home/.claude/plugins/installed_plugins.json"),
            "{not json",
        );
        assert!(list_in(&root.join("home/.claude"), Path::new("relative/cwd")).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_descriptions_are_capped() {
        let root = temp_root("cap");
        let home = root.join("home/.claude");
        write(
            &home.join("commands/long.md"),
            &format!("---\ndescription: {}\n---\n", "word ".repeat(200)),
        );
        let list = list_in(&home, &root);
        assert!(list[0].description.chars().count() <= DESCRIPTION_CAP + 1);
        assert!(list[0].description.ends_with('…'));
        std::fs::remove_dir_all(root).unwrap();
    }
}
