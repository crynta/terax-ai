#![cfg(all(target_os = "macos", feature = "openclicky"))]

fn parse_shortcut_impl(s: &str) -> Result<(Option<u32>, &'static str), String> {
    let mut mods: u32 = 0;
    let mut code: Option<&'static str> = None;

    for part in s.split('+') {
        let part = part.trim();
        match part.to_lowercase().as_str() {
            "alt" => mods |= 1,
            "ctrl" | "control" => mods |= 2,
            "shift" => mods |= 4,
            "super" | "cmd" | "meta" => mods |= 8,
            "space" => code = Some("Space"),
            "enter" | "return" => code = Some("Enter"),
            "a" => code = Some("KeyA"),
            "b" => code = Some("KeyB"),
            _ => return Err(format!("unknown shortcut part: {part}")),
        }
    }

    let code = code.ok_or("shortcut must include a key")?;
    Ok((if mods > 0 { Some(mods) } else { None }, code))
}

#[test]
fn parse_shortcut_single_key() {
    let (mods, code) = parse_shortcut_impl("A").unwrap();
    assert!(mods.is_none());
    assert_eq!(code, "KeyA");
}

#[test]
fn parse_shortcut_alt_space() {
    let (mods, code) = parse_shortcut_impl("Alt+Space").unwrap();
    assert_eq!(mods, Some(1));
    assert_eq!(code, "Space");
}

#[test]
fn parse_shortcut_ctrl_shift_enter() {
    let (mods, code) = parse_shortcut_impl("Ctrl+Shift+Enter").unwrap();
    assert_eq!(mods, Some(6));
    assert_eq!(code, "Enter");
}

#[test]
fn parse_shortcut_missing_key() {
    let result = parse_shortcut_impl("Alt");
    assert!(result.is_err());
}

#[test]
fn parse_shortcut_unknown_part() {
    let result = parse_shortcut_impl("Alt+F24");
    assert!(result.is_err());
}

#[test]
fn parse_shortcut_case_insensitive() {
    let (_, code1) = parse_shortcut_impl("alt+space").unwrap();
    let (_, code2) = parse_shortcut_impl("ALT+SPACE").unwrap();
    assert_eq!(code1, code2);
}
