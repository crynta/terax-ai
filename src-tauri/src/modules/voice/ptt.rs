use std::sync::{Arc, Mutex};

use tauri::AppHandle;

pub struct PttState {
    registered: Arc<Mutex<bool>>,
}

impl PttState {
    pub fn new() -> Self {
        Self {
            registered: Arc::new(Mutex::new(false)),
        }
    }
}

impl Default for PttState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(target_os = "macos", feature = "openclicky"))]
fn parse_shortcut(s: &str) -> Result<(Option<tauri_plugin_global_shortcut::Modifiers>, tauri_plugin_global_shortcut::Code), String> {
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    let mut mods = None;
    let mut code = None;

    for part in s.split('+') {
        let part = part.trim();
        match part.to_lowercase().as_str() {
            "alt" => mods = Some(mods.unwrap_or(Modifiers::empty()) | Modifiers::ALT),
            "ctrl" | "control" => mods = Some(mods.unwrap_or(Modifiers::empty()) | Modifiers::CONTROL),
            "shift" => mods = Some(mods.unwrap_or(Modifiers::empty()) | Modifiers::SHIFT),
            "super" | "cmd" | "meta" => mods = Some(mods.unwrap_or(Modifiers::empty()) | Modifiers::SUPER),
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            "tab" => code = Some(Code::Tab),
            "escape" | "esc" => code = Some(Code::Escape),
            c if c.len() == 1 && c.chars().all(|ch| ch.is_ascii_alphabetic()) => {
                code = Some(match c.to_ascii_uppercase().as_str() {
                    "A" => Code::KeyA, "B" => Code::KeyB, "C" => Code::KeyC, "D" => Code::KeyD,
                    "E" => Code::KeyE, "F" => Code::KeyF, "G" => Code::KeyG, "H" => Code::KeyH,
                    "I" => Code::KeyI, "J" => Code::KeyJ, "K" => Code::KeyK, "L" => Code::KeyL,
                    "M" => Code::KeyM, "N" => Code::KeyN, "O" => Code::KeyO, "P" => Code::KeyP,
                    "Q" => Code::KeyQ, "R" => Code::KeyR, "S" => Code::KeyS, "T" => Code::KeyT,
                    "U" => Code::KeyU, "V" => Code::KeyV, "W" => Code::KeyW, "X" => Code::KeyX,
                    "Y" => Code::KeyY, "Z" => Code::KeyZ,
                    _ => return Err(format!("unsupported key: {part}")),
                });
            }
            _ => return Err(format!("unknown shortcut part: {part}")),
        }
    }

    let code = code.ok_or("shortcut must include a key")?;
    Ok((mods, code))
}

#[tauri::command]
pub fn ptt_register(
    app: AppHandle,
    state: tauri::State<'_, PttState>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let key = shortcut.unwrap_or_else(|| "Alt+Space".to_string());

    {
        let reg = state.registered.lock().map_err(|e| e.to_string())?;
        if *reg {
            return Ok(());
        }
    }

    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        use tauri_plugin_global_shortcut::Shortcut;

        let (modifiers, code) = parse_shortcut(&key)?;
        let shortcut_def = Shortcut::new(modifiers, code);
        app.global_shortcut()
            .register(shortcut_def)
            .map_err(|e| format!("failed to register shortcut: {e}"))?;
    }

    {
        let mut reg = state.registered.lock().map_err(|e| e.to_string())?;
        *reg = true;
    }

    Ok(())
}

#[tauri::command]
pub fn ptt_unregister(
    app: AppHandle,
    state: tauri::State<'_, PttState>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let key = shortcut.unwrap_or_else(|| "Alt+Space".to_string());

    #[cfg(all(target_os = "macos", feature = "openclicky"))]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        use tauri_plugin_global_shortcut::Shortcut;

        let (modifiers, code) = match parse_shortcut(&key) {
            Ok((m, c)) => (m, c),
            Err(_) => return Ok(()),
        };
        let shortcut_def = Shortcut::new(modifiers, code);
        let _ = app.global_shortcut().unregister(shortcut_def);
    }

    {
        let mut reg = state.registered.lock().map_err(|e| e.to_string())?;
        *reg = false;
    }

    Ok(())
}
