use std::path::{Path, PathBuf};

const ALLOWED_BINARIES: &[&str] = &[
    "typescript-language-server",
    "rust-analyzer",
    "pyright-langserver",
    "pylsp",
    "gopls",
    "clangd",
    "bash-language-server",
    "json-languageserver",
    "vscode-json-language-server",
    "deps-lsp",
    "intelephense",
];

pub fn binary_stem(command: &str) -> &str {
    Path::new(command)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
}

pub fn is_allowed_command(command: &str) -> bool {
    ALLOWED_BINARIES.contains(&binary_stem(command))
}

fn candidate_names(stem: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        return vec![
            format!("{stem}.cmd"),
            format!("{stem}.exe"),
            format!("{stem}.bat"),
            stem.to_string(),
        ];
    }
    #[cfg(not(windows))]
    {
        vec![stem.to_string()]
    }
}

#[cfg(windows)]
fn normalize_windows_executable(path: PathBuf) -> PathBuf {
    if !path.is_file() {
        return path;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(ext.as_str(), "cmd" | "exe" | "bat") {
        return path;
    }
    if ext.is_empty() {
        for alt in ["cmd", "exe", "bat"] {
            let sibling = path.with_extension(alt);
            if sibling.is_file() {
                return sibling;
            }
        }
    }
    path
}

fn search_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".local").join("bin"));
        #[cfg(windows)]
        {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
            dirs.push(home.join("AppData").join("Local").join("pnpm"));
            dirs.push(
                home.join("AppData")
                    .join("Local")
                    .join("Programs")
                    .join("nodejs"),
            );
            dirs.push(home.join(".local").join("share").join("pnpm"));
            if let Ok(nvm_home) = std::env::var("NVM_HOME") {
                let nodejs = PathBuf::from(&nvm_home).join("nodejs");
                dirs.push(nodejs.join("node_modules").join(".bin"));
                dirs.push(nodejs);
            }
            if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
                dirs.push(PathBuf::from(nvm_symlink));
            }
            dirs.push(PathBuf::from(r"C:\nvm4w\nodejs"));
            dirs.push(
                PathBuf::from(r"C:\nvm4w\nodejs").join("node_modules").join(".bin"),
            );
        }
        #[cfg(windows)]
        {
            dirs.push(home.join("go").join("bin"));
            dirs.push(home.join("scoop").join("shims"));
            dirs.push(PathBuf::from(r"C:\Program Files\Go\bin"));
            dirs.push(PathBuf::from(r"C:\Program Files (x86)\Go\bin"));
        }
        #[cfg(not(windows))]
        {
            dirs.push(home.join("go").join("bin"));
            dirs.push(PathBuf::from("/usr/local/go/bin"));
        }
        if let Ok(gopath) = std::env::var("GOPATH") {
            if !gopath.is_empty() {
                dirs.push(PathBuf::from(gopath).join("bin"));
            }
        }
        #[cfg(target_os = "macos")]
        {
            dirs.push(home.join(".npm-global").join("bin"));
            dirs.push(PathBuf::from("/opt/homebrew/bin"));
            dirs.push(PathBuf::from("/usr/local/bin"));
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

fn which_in_paths(name: &str) -> Option<PathBuf> {
    for dir in search_path_dirs() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn normalize_executable(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        return normalize_windows_executable(path);
    }
    #[cfg(not(windows))]
    {
        path
    }
}

fn resolve_stems(stem: &str) -> Vec<String> {
    match stem {
        "vscode-json-language-server" | "json-languageserver" => {
            vec![
                "vscode-json-language-server".into(),
                "json-languageserver".into(),
            ]
        }
        other => vec![other.to_string()],
    }
}

fn find_on_system(stem: &str, trimmed: &str) -> Option<PathBuf> {
    let as_path = PathBuf::from(trimmed);
    if as_path.is_absolute() && as_path.is_file() {
        return Some(normalize_executable(as_path));
    }
    for stem in resolve_stems(stem) {
        for name in candidate_names(&stem) {
            if let Some(found) = which_in_paths(&name) {
                return Some(normalize_executable(found));
            }
        }
    }
    None
}

pub fn find_system_go() -> Option<PathBuf> {
    #[cfg(windows)]
    let names = ["go.exe", "go"];
    #[cfg(not(windows))]
    let names = ["go"];
    for name in names {
        if let Some(found) = which_in_paths(name) {
            return Some(found);
        }
    }
    None
}

pub fn resolve_lsp(command: &str) -> Result<LspTarget, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("empty lsp command".into());
    }
    let stem = binary_stem(trimmed);
    if !ALLOWED_BINARIES.contains(&stem) {
        return Err(format!("lsp command not allowed: {trimmed}"));
    }

    for stem in resolve_stems(stem) {
        if let Some(super::links::LspBinaryLink::Path { path }) = super::links::get_link(&stem) {
            return link_to_target(super::links::LspBinaryLink::Path { path });
        }
    }

    if let Some(found) = find_on_system(stem, trimmed) {
        return Ok(LspTarget::Host {
            path: found,
            source: LspSource::System,
        });
    }

    for stem in resolve_stems(stem) {
        if let Some(local) = super::local::find_local_binary(&stem) {
            return Ok(LspTarget::Host {
                path: normalize_executable(local),
                source: LspSource::Terax,
            });
        }
    }

    for stem in resolve_stems(stem) {
        if let Some(super::links::LspBinaryLink::Wsl { distro, command }) =
            super::links::get_link(&stem)
        {
            return link_to_target(super::links::LspBinaryLink::Wsl { distro, command });
        }
    }

    Err(format!(
        "language server not installed: {stem}. Link an existing binary, or use Install for Terax in Settings → Languages."
    ))
}

fn link_to_target(link: super::links::LspBinaryLink) -> Result<LspTarget, String> {
    match link {
        super::links::LspBinaryLink::Path { path } => {
            let path_buf = PathBuf::from(path.trim());
            if !path_buf.is_file() {
                return Err(format!("linked file not found: {}", path_buf.display()));
            }
            Ok(LspTarget::Host {
                path: normalize_executable(path_buf),
                source: LspSource::Linked,
            })
        }
        super::links::LspBinaryLink::Wsl { distro, command } => Ok(LspTarget::Wsl {
            distro,
            command,
        }),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LspSource {
    Linked,
    System,
    Terax,
}

#[derive(Debug, Clone)]
pub enum LspTarget {
    Host {
        path: PathBuf,
        source: LspSource,
    },
    Wsl {
        distro: String,
        command: String,
    },
}

impl LspTarget {
    pub fn display_path(&self) -> String {
        match self {
            LspTarget::Host { path, .. } => path.to_string_lossy().into_owned(),
            LspTarget::Wsl { distro, command } => {
                if command.starts_with('/') {
                    format!("wsl:{distro}:{command}")
                } else {
                    format!("wsl:{distro}/{command}")
                }
            }
        }
    }

    pub fn is_wsl(&self) -> bool {
        matches!(self, LspTarget::Wsl { .. })
    }

    pub fn is_linked(&self) -> bool {
        matches!(
            self,
            LspTarget::Host {
                source: LspSource::Linked,
                ..
            }
        ) || self.is_wsl()
    }

    pub fn is_terax_local(&self) -> bool {
        matches!(
            self,
            LspTarget::Host {
                source: LspSource::Terax,
                ..
            }
        )
    }

    pub fn source_label(&self) -> &'static str {
        match self {
            LspTarget::Wsl { .. } => "linked",
            LspTarget::Host { source: LspSource::Linked, .. } => "linked",
            LspTarget::Host { source: LspSource::System, .. } => "system",
            LspTarget::Host { source: LspSource::Terax, .. } => "terax",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_cmd_extension() {
        assert!(is_allowed_command("typescript-language-server.cmd"));
        assert!(is_allowed_command(
            r"C:\Users\dev\AppData\Roaming\npm\rust-analyzer.exe"
        ));
    }

    #[test]
    fn windows_prefers_cmd_before_shim() {
        let names = candidate_names("typescript-language-server");
        assert_eq!(names[0], "typescript-language-server.cmd");
    }
}
