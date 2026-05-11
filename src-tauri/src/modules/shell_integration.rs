use std::path::PathBuf;

#[tauri::command]
pub fn shell_integration_register() -> Result<(), String> {
    platform::register()
}

#[tauri::command]
pub fn shell_integration_unregister() -> Result<(), String> {
    platform::unregister()
}

#[tauri::command]
pub fn shell_integration_status() -> Result<bool, String> {
    platform::status()
}

fn app_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("failed to locate Terax executable: {e}"))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "failed to locate home directory".to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "windows")]
mod platform {
    use super::app_exe;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const SHELL_KEYS: [&str; 3] = [
        r"HKCU\Software\Classes\Directory\shell\Terax",
        r"HKCU\Software\Classes\Directory\Background\shell\Terax",
        r"HKCU\Software\Classes\Drive\shell\Terax",
    ];
    const COMMAND_KEYS: [&str; 3] = [
        r"HKCU\Software\Classes\Directory\shell\Terax\command",
        r"HKCU\Software\Classes\Directory\Background\shell\Terax\command",
        r"HKCU\Software\Classes\Drive\shell\Terax\command",
    ];

    pub fn register() -> Result<(), String> {
        let exe = app_exe()?;
        let exe = exe.to_string_lossy();
        let command_for_path = format!("\"{exe}\" \"%1\"");
        let command_for_background = format!("\"{exe}\" \"%V\"");

        for key in SHELL_KEYS {
            reg(&["add", key, "/ve", "/d", "Open in Terax", "/f"])?;
            reg(&["add", key, "/v", "Icon", "/d", &exe, "/f"])?;
        }
        reg(&["add", COMMAND_KEYS[0], "/ve", "/d", &command_for_path, "/f"])?;
        reg(
            &[
                "add",
                COMMAND_KEYS[1],
                "/ve",
                "/d",
                &command_for_background,
                "/f",
            ],
        )?;
        reg(&["add", COMMAND_KEYS[2], "/ve", "/d", &command_for_path, "/f"])?;
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        for key in SHELL_KEYS {
            let _ = reg(&["delete", key, "/f"]);
        }
        Ok(())
    }

    pub fn status() -> Result<bool, String> {
        Ok(COMMAND_KEYS.iter().all(|key| reg_query(key)))
    }

    fn reg(args: &[&str]) -> Result<(), String> {
        let status = Command::new("reg")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("failed to run reg.exe: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("reg.exe failed with status {status}"))
        }
    }

    fn reg_query(key: &str) -> bool {
        Command::new("reg")
            .args(["query", key])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{app_exe, home_dir, shell_quote};
    use std::fs;

    const SERVICE_NAME: &str = "Open in Terax.workflow";

    pub fn register() -> Result<(), String> {
        let exe = shell_quote(&app_exe()?.to_string_lossy());
        let service_dir = service_dir()?;
        let contents_dir = service_dir.join("Contents");
        fs::create_dir_all(&contents_dir)
            .map_err(|e| format!("failed to create service directory: {e}"))?;

        fs::write(contents_dir.join("Info.plist"), info_plist())
            .map_err(|e| format!("failed to write Info.plist: {e}"))?;
        fs::write(contents_dir.join("document.wflow"), document_wflow(&exe))
            .map_err(|e| format!("failed to write Automator workflow: {e}"))?;
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        let dir = service_dir()?;
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|e| format!("failed to remove Automator workflow: {e}"))?;
        }
        Ok(())
    }

    pub fn status() -> Result<bool, String> {
        Ok(service_dir()?.join("Contents/document.wflow").exists())
    }

    fn service_dir() -> Result<std::path::PathBuf, String> {
        Ok(home_dir()?.join("Library/Services").join(SERVICE_NAME))
    }

    fn info_plist() -> &'static str {
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>Open in Terax</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.folder</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
"#
    }

    fn document_wflow(exe: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Optional</key>
          <true/>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.path</string>
          </array>
        </dict>
        <key>AMActionVersion</key>
        <string>2.0.3</string>
        <key>AMApplication</key>
        <array>
          <string>Automator</string>
        </array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key>
          <dict/>
          <key>inputMethod</key>
          <dict/>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.string</string>
          </array>
        </dict>
        <key>ActionBundlePath</key>
        <string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key>
        <string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key>
          <string>for f in "$@"; do
  {exe} "$f" &amp;
done</string>
          <key>CheckedForUserDefaultShell</key>
          <true/>
          <key>inputMethod</key>
          <integer>1</integer>
          <key>shell</key>
          <string>/bin/sh</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>connectors</key>
  <dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>serviceApplicationBundleID</key>
    <string>com.apple.finder</string>
    <key>serviceInputTypeIdentifier</key>
    <string>com.apple.Automator.fileSystemObject</string>
    <key>serviceOutputTypeIdentifier</key>
    <string>com.apple.Automator.nothing</string>
  </dict>
</dict>
</plist>
"#
        )
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{app_exe, home_dir, shell_quote};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    pub fn register() -> Result<(), String> {
        let exe = app_exe()?.to_string_lossy().to_string();
        write_nautilus_script(&exe)?;
        write_desktop_entry(&exe)?;
        write_dolphin_service_menu(&exe)?;
        refresh_desktop_database();
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        for path in [nautilus_script()?, desktop_entry()?, dolphin_service_menu()?] {
            if path.exists() {
                fs::remove_file(&path)
                    .map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
            }
        }
        refresh_desktop_database();
        Ok(())
    }

    pub fn status() -> Result<bool, String> {
        Ok(nautilus_script()?.exists() && desktop_entry()?.exists())
    }

    fn write_nautilus_script(exe: &str) -> Result<(), String> {
        let path = nautilus_script()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create Nautilus scripts directory: {e}"))?;
        }
        let exe = shell_quote(exe);
        let script = format!(
            r#"#!/bin/sh
TERAX={exe}

if [ -n "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS" ]; then
  printf '%s\n' "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS" | while IFS= read -r path; do
    [ -n "$path" ] && "$TERAX" "$path" &
  done
else
  "$TERAX" "${{1:-$PWD}}" &
fi
"#
        );
        fs::write(&path, script)
            .map_err(|e| format!("failed to write Nautilus script: {e}"))?;
        let mut perms = fs::metadata(&path)
            .map_err(|e| format!("failed to read Nautilus script metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms)
            .map_err(|e| format!("failed to make Nautilus script executable: {e}"))
    }

    fn write_desktop_entry(exe: &str) -> Result<(), String> {
        let path = desktop_entry()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create applications directory: {e}"))?;
        }
        let entry = format!(
            r#"[Desktop Entry]
Type=Application
Name=Open in Terax
Comment=Open this folder in Terax
Exec={} %f
Icon=terax
Terminal=false
NoDisplay=false
MimeType=inode/directory;
Categories=Utility;TerminalEmulator;Development;
"#,
            desktop_exec(exe)
        );
        fs::write(&path, entry).map_err(|e| format!("failed to write desktop entry: {e}"))
    }

    fn write_dolphin_service_menu(exe: &str) -> Result<(), String> {
        let path = dolphin_service_menu()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create Dolphin service menu directory: {e}"))?;
        }
        let entry = format!(
            r#"[Desktop Entry]
Type=Service
MimeType=inode/directory;
Actions=openInTerax;
X-KDE-Priority=TopLevel

[Desktop Action openInTerax]
Name=Open in Terax
Icon=terax
Exec={} %f
"#,
            desktop_exec(exe)
        );
        fs::write(&path, entry)
            .map_err(|e| format!("failed to write Dolphin service menu: {e}"))
    }

    fn desktop_exec(exe: &str) -> String {
        if exe.contains(' ') {
            format!("\"{}\"", exe.replace('"', "\\\""))
        } else {
            exe.to_string()
        }
    }

    fn refresh_desktop_database() {
        let _ = Command::new("update-desktop-database")
            .arg(home_dir().map(|p| p.join(".local/share/applications")).unwrap_or_default())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    fn nautilus_script() -> Result<PathBuf, String> {
        Ok(home_dir()?.join(".local/share/nautilus/scripts/Open in Terax"))
    }

    fn desktop_entry() -> Result<PathBuf, String> {
        Ok(home_dir()?.join(".local/share/applications/terax-open-directory.desktop"))
    }

    fn dolphin_service_menu() -> Result<PathBuf, String> {
        Ok(home_dir()?.join(".local/share/kio/servicemenus/terax-open-directory.desktop"))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod platform {
    pub fn register() -> Result<(), String> {
        Err("shell integration is not supported on this platform".to_string())
    }

    pub fn unregister() -> Result<(), String> {
        Err("shell integration is not supported on this platform".to_string())
    }

    pub fn status() -> Result<bool, String> {
        Ok(false)
    }
}
