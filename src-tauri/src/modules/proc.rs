use std::path::Path;
use std::process::Command;

#[cfg(windows)]
pub fn command_for_executable(path: &Path) -> Command {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "cmd" || ext == "bat" {
        let path_str = path.to_string_lossy().into_owned();
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", &path_str]);
        return cmd;
    }
    Command::new(path)
}

#[cfg(not(windows))]
pub fn command_for_executable(path: &Path) -> Command {
    Command::new(path)
}

#[cfg(windows)]
pub fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
#[inline]
pub fn hide_console(_cmd: &mut Command) {}
