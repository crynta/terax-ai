use std::path::Path;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

fn command_base(command: &str) -> &str {
    Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
}

fn markers_for(command: &str) -> &'static [&'static str] {
    match command_base(command) {
        "rust-analyzer" => &["Cargo.toml"],
        "typescript-language-server" => &["tsconfig.json", "jsconfig.json", "package.json"],
        "pyright-langserver" | "pylsp" => {
            &["pyproject.toml", "pyrightconfig.json", "setup.cfg", "setup.py"]
        }
        "gopls" => &["go.mod"],
        "clangd" => &["compile_commands.json", "CMakeLists.txt", "Cargo.toml"],
        "json-languageserver" | "vscode-json-language-server" => &["package.json", "tsconfig.json"],
        "deps-lsp" => &[
            "package.json",
            "Cargo.toml",
            "pyproject.toml",
            "go.mod",
            "composer.json",
            "Gemfile",
            "pubspec.yaml",
        ],
        "intelephense" => &["composer.json", "phpunit.xml", "phpunit.xml.dist"],
        _ => &["Cargo.toml", "package.json", "go.mod"],
    }
}

fn path_display(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Walk upward from `file_path` until a language-specific project marker is found.
pub fn resolve_project_root(file_path: &str, command: &str, workspace: &WorkspaceEnv) -> String {
    let resolved = resolve_path(file_path, workspace);
    let mut dir = resolved
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| resolved.clone());
    let fallback = dir.clone();
    let markers = markers_for(command);

    loop {
        for marker in markers {
            let candidate = dir.join(marker);
            if candidate.is_file() {
                return path_display(&dir);
            }
        }
        if !dir.pop() {
            break;
        }
    }

    path_display(&fallback)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn finds_cargo_toml_above_src() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        let file = root.join("src").join("lib.rs");
        fs::write(&file, "fn main() {}\n").unwrap();

        let got = resolve_project_root(
            &file.to_string_lossy(),
            "rust-analyzer",
            &WorkspaceEnv::Local,
        );
        assert_eq!(got, path_display(root));
    }
}
