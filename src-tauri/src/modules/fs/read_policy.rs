use regex::RegexSetBuilder;
use serde::Deserialize;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathPolicy {
    secret_basenames: Vec<String>,
    protected_dirs: Vec<String>,
}

pub(super) fn readable(path: &Path) -> Result<(), String> {
    if let Some(cache) = dirs::cache_dir() {
        deny_runtime_directory(path, &cache.join("terax"))?;
    }
    static POLICY: OnceLock<(regex::RegexSet, Vec<String>)> = OnceLock::new();
    let (patterns, directories) = POLICY.get_or_init(|| {
        let policy: PathPolicy = serde_json::from_str(include_str!(
            "../../../../src/modules/ai/lib/pathPolicy.json"
        ))
        .expect("valid path policy");
        (
            RegexSetBuilder::new(policy.secret_basenames)
                .case_insensitive(true)
                .build()
                .expect("valid secret patterns"),
            policy.protected_dirs,
        )
    });
    let path = path.to_str().ok_or("refused non-UTF-8 AI path")?;
    if path.is_empty() || path.chars().any(|c| c < ' ') {
        return Err("refused invalid AI path".into());
    }
    let normalized = path.replace('\\', "/");
    let basename = normalized.rsplit('/').next().unwrap_or("");
    if patterns.is_match(&basename.replace('\u{feff}', " ")) {
        return Err("refused sensitive AI file".into());
    }
    let comparison = normalized
        .split('/')
        .map(|part| {
            part.split(':')
                .next()
                .unwrap_or("")
                .trim_end_matches(|c: char| c == '.' || c == '\u{feff}' || c.is_whitespace())
                .to_lowercase()
        })
        .collect::<Vec<_>>()
        .join("/");
    let comparison = format!("{comparison}/");
    if directories
        .iter()
        .any(|dir| comparison.contains(&format!("{dir}/")))
    {
        return Err("refused protected AI directory".into());
    }
    Ok(())
}

fn deny_runtime_directory(path: &Path, directory: &Path) -> Result<(), String> {
    if path.starts_with(directory)
        || std::fs::canonicalize(directory).is_ok_and(|canonical| path.starts_with(canonical))
    {
        return Err("refused application credential directory".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocated_runtime_credentials_are_protected() {
        let tmp = tempfile::tempdir().unwrap();
        let relocated = tmp.path().join("custom-cache").join("terax");
        std::fs::create_dir_all(&relocated).unwrap();
        let actual = std::fs::canonicalize(&relocated).unwrap();
        assert!(deny_runtime_directory(&actual.join("control.json"), &relocated).is_err());
        assert!(deny_runtime_directory(&actual.join("control.json.tmp-abc"), &relocated).is_err());
        assert!(deny_runtime_directory(&tmp.path().join("source.ts"), &relocated).is_ok());
        #[cfg(unix)]
        {
            let alias = tmp.path().join("cache-alias");
            std::os::unix::fs::symlink(&relocated, &alias).unwrap();
            assert!(deny_runtime_directory(&actual.join("control.json"), &alias).is_err());
        }
    }

    #[test]
    fn javascript_bom_whitespace_is_also_sensitive_natively() {
        for path in [
            "/repo/.env\u{feff}x",
            "/repo/.ssh\u{feff}/key",
            "/repo/secrets.json.tmp-abc",
        ] {
            assert!(readable(Path::new(path)).is_err(), "{path}");
        }
        assert!(readable(Path::new("/repo/environment.ts")).is_ok());
    }
}
