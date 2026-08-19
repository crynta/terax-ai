use serde::Serialize;

/// The translucent window backdrop a platform can provide.
///
/// Linux is `None` on purpose: blur there is owned by the compositor, not the
/// app, so the settings toggle is hidden rather than offered as a dead switch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Backdrop {
    /// macOS `NSVisualEffectView`.
    Vibrancy,
    /// Windows 11 Mica.
    Mica,
    None,
}

pub fn backdrop_for(os: &str) -> Backdrop {
    match os {
        "macos" => Backdrop::Vibrancy,
        "windows" => Backdrop::Mica,
        _ => Backdrop::None,
    }
}

#[tauri::command]
pub fn window_backdrop_kind() -> Backdrop {
    backdrop_for(std::env::consts::OS)
}

/// `dark` only matters for Mica, which tints its own backdrop and cannot read
/// the webview's theme.
#[tauri::command]
pub fn window_set_backdrop(
    window: tauri::Window,
    enabled: bool,
    dark: bool,
) -> Result<(), String> {
    set_backdrop(&window, enabled, dark)
}

#[cfg(target_os = "macos")]
fn set_backdrop(window: &tauri::Window, enabled: bool, _dark: bool) -> Result<(), String> {
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

    if enabled {
        // UnderWindowBackground is the material meant for a whole-window
        // backdrop; Sidebar/HudWindow are for panels drawn on top of content.
        apply_vibrancy(window, NSVisualEffectMaterial::UnderWindowBackground, None, None)
            .map_err(|e| e.to_string())
    } else {
        clear_vibrancy(window).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "windows")]
fn set_backdrop(window: &tauri::Window, enabled: bool, dark: bool) -> Result<(), String> {
    use window_vibrancy::{apply_mica, clear_mica};

    if enabled {
        apply_mica(window, Some(dark)).map_err(|e| e.to_string())
    } else {
        clear_mica(window).map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_backdrop(_window: &tauri::Window, _enabled: bool, _dark: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{backdrop_for, Backdrop};

    #[test]
    fn maps_each_platform_to_its_backdrop() {
        assert_eq!(backdrop_for("macos"), Backdrop::Vibrancy);
        assert_eq!(backdrop_for("windows"), Backdrop::Mica);
    }

    #[test]
    fn unsupported_platforms_report_none() {
        assert_eq!(backdrop_for("linux"), Backdrop::None);
        assert_eq!(backdrop_for("freebsd"), Backdrop::None);
        assert_eq!(backdrop_for(""), Backdrop::None);
    }

    #[test]
    fn serializes_as_kebab_case_for_the_webview() {
        assert_eq!(
            serde_json::to_string(&Backdrop::Vibrancy).unwrap(),
            "\"vibrancy\""
        );
        assert_eq!(serde_json::to_string(&Backdrop::None).unwrap(), "\"none\"");
    }
}
