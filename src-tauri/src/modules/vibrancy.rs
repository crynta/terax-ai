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

/// First Windows 11 build. `apply_mica` fails below it.
const WIN11_BUILD: u32 = 22000;

pub fn backdrop_for(os: &str, build: u32) -> Backdrop {
    match os {
        "macos" => Backdrop::Vibrancy,
        "windows" if build >= WIN11_BUILD => Backdrop::Mica,
        _ => Backdrop::None,
    }
}

#[tauri::command]
pub fn window_backdrop_kind() -> Backdrop {
    backdrop_for(std::env::consts::OS, os_build())
}

/// Window background used when the frontend cannot report the theme colour.
fn fallback_background(dark: bool) -> [u8; 3] {
    if dark {
        [0x14, 0x14, 0x14]
    } else {
        [0xff, 0xff, 0xff]
    }
}

/// `#rrggbb` as sent by the frontend. Anything else is ignored rather than
/// trusted.
pub fn parse_hex_rgb(value: &str) -> Option<[u8; 3]> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// Turns the backdrop on or off. Runs on the main thread (a plain command), as
/// AppKit and DWM calls require.
///
/// The window is created opaque. Only while a backdrop is on is it made
/// see-through, because a non-opaque window makes the compositor blend every
/// frame of the terminal with whatever is behind it, even when nothing shows
/// through. With the backdrop off the window is opaque again and painted with
/// `background` (the theme's window colour, `#rrggbb`).
///
/// `dark` only matters for Mica, which tints its own backdrop and cannot read
/// the webview's theme.
#[tauri::command]
pub fn window_set_backdrop(
    window: tauri::WebviewWindow,
    enabled: bool,
    dark: bool,
    background: Option<String>,
) -> Result<(), String> {
    let rgb = background
        .as_deref()
        .and_then(parse_hex_rgb)
        .unwrap_or_else(|| fallback_background(dark));
    set_backdrop(&window, enabled, dark, rgb)
}

#[cfg(target_os = "windows")]
fn os_build() -> u32 {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;

    // GetVersionExW reports 6.2 for unmanifested apps; RtlGetVersion does not.
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    if unsafe { RtlGetVersion(&mut info) } == 0 {
        info.dwBuildNumber
    } else {
        0
    }
}

#[cfg(not(target_os = "windows"))]
fn os_build() -> u32 {
    0
}

#[cfg(target_os = "macos")]
fn set_backdrop(
    window: &tauri::WebviewWindow,
    enabled: bool,
    _dark: bool,
    rgb: [u8; 3],
) -> Result<(), String> {
    use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

    if enabled {
        set_window_see_through(window, true, rgb)?;
        // UnderWindowBackground is the material meant for a whole-window
        // backdrop; Sidebar/HudWindow are for panels drawn on top of content.
        apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        )
        .map_err(|e| e.to_string())
    } else {
        clear_vibrancy(window).map_err(|e| e.to_string())?;
        set_window_see_through(window, false, rgb)
    }
}

/// Toggles the web view's own fill through key-value coding.
///
/// `setValue:forKey:` raises an `NSException` for a key the receiver does not
/// accept, which WebKit can change between releases. Unwinding that through the
/// Rust frames above would abort the process, so it is caught and reported.
///
/// # Safety
/// `view` must point to a live Objective-C object, and the call must be on the
/// thread that owns it.
#[cfg(target_os = "macos")]
unsafe fn set_draws_background(
    view: *mut objc2::runtime::AnyObject,
    draws: bool,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2_foundation::{NSNumber, NSString};

    let key = NSString::from_str("drawsBackground");
    let value = NSNumber::numberWithBool(draws);
    objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
        let _: () = msg_send![view, setValue: &*value, forKey: &*key];
    }))
    .map_err(|exception| {
        let reason =
            exception.map_or_else(|| "unknown exception".to_string(), |e| format!("{e:?}"));
        log::error!("could not set drawsBackground on the web view: {reason}");
        reason
    })
}

/// Makes the NSWindow and its WKWebView non-opaque (or opaque again).
/// `drawsBackground` is the same WebKit key wry sets for a transparent window;
/// it is the only way to toggle the web view's own fill at runtime.
#[cfg(target_os = "macos")]
fn set_window_see_through(
    window: &tauri::WebviewWindow,
    see_through: bool,
    rgb: [u8; 3],
) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSColor, NSWindow};

    window
        .with_webview(move |platform| unsafe {
            // The closure runs on the main thread, which owns both objects.
            let ns_window = platform.ns_window() as *mut NSWindow;
            let webview = platform.inner() as *mut AnyObject;
            // Already logged; the window itself can still be updated.
            let _ = set_draws_background(webview, !see_through);

            let native = &*ns_window;
            let color = if see_through {
                NSColor::clearColor()
            } else {
                NSColor::colorWithSRGBRed_green_blue_alpha(
                    f64::from(rgb[0]) / 255.0,
                    f64::from(rgb[1]) / 255.0,
                    f64::from(rgb[2]) / 255.0,
                    1.0,
                )
            };
            native.setBackgroundColor(Some(&color));
            native.setOpaque(!see_through);
            // The shadow follows the window's opaque pixels.
            native.invalidateShadow();
        })
        .map_err(|e| e.to_string())
}

// Windows and Linux keep their windows transparent from creation: the custom
// borderless chrome paints its own rounded corners over a transparent frame.
#[cfg(target_os = "windows")]
fn set_backdrop(
    window: &tauri::WebviewWindow,
    enabled: bool,
    dark: bool,
    _rgb: [u8; 3],
) -> Result<(), String> {
    use window_vibrancy::{apply_mica, clear_mica};

    if enabled {
        apply_mica(window, Some(dark)).map_err(|e| e.to_string())
    } else {
        clear_mica(window).map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_backdrop(
    _window: &tauri::WebviewWindow,
    _enabled: bool,
    _dark: bool,
    _rgb: [u8; 3],
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{backdrop_for, fallback_background, parse_hex_rgb, Backdrop, WIN11_BUILD};

    #[test]
    fn frontend_colours_parse_strictly() {
        assert_eq!(parse_hex_rgb("#141414"), Some([0x14, 0x14, 0x14]));
        assert_eq!(parse_hex_rgb("#FfA0b1"), Some([0xff, 0xa0, 0xb1]));
        for bad in [
            "",
            "141414",
            "#14141",
            "#1414144",
            "#12345g",
            "#+12345",
            "rgb(0,0,0)",
            "#é1234",
        ] {
            assert_eq!(parse_hex_rgb(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_fallback_matches_the_prepaint_colours_in_index_html() {
        assert_eq!(fallback_background(true), [0x14, 0x14, 0x14]);
        assert_eq!(fallback_background(false), [0xff, 0xff, 0xff]);
    }

    #[test]
    fn macos_reports_vibrancy_regardless_of_build() {
        assert_eq!(backdrop_for("macos", 0), Backdrop::Vibrancy);
    }

    #[test]
    fn windows_11_reports_mica() {
        assert_eq!(backdrop_for("windows", WIN11_BUILD), Backdrop::Mica);
        assert_eq!(backdrop_for("windows", 26100), Backdrop::Mica);
    }

    #[test]
    fn windows_10_reports_none_because_mica_would_fail() {
        assert_eq!(backdrop_for("windows", WIN11_BUILD - 1), Backdrop::None);
        assert_eq!(backdrop_for("windows", 19045), Backdrop::None);
        assert_eq!(backdrop_for("windows", 0), Backdrop::None);
    }

    #[test]
    fn unsupported_platforms_report_none() {
        assert_eq!(backdrop_for("linux", 99999), Backdrop::None);
        assert_eq!(backdrop_for("freebsd", 0), Backdrop::None);
        assert_eq!(backdrop_for("", 0), Backdrop::None);
    }

    #[test]
    fn serializes_as_kebab_case_for_the_webview() {
        assert_eq!(
            serde_json::to_string(&Backdrop::Vibrancy).unwrap(),
            "\"vibrancy\""
        );
        assert_eq!(serde_json::to_string(&Backdrop::None).unwrap(), "\"none\"");
    }

    #[cfg(target_os = "macos")]
    mod objc {
        use super::super::set_draws_background;
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};

        fn instance(class: &std::ffi::CStr) -> *mut AnyObject {
            let class = AnyClass::get(class).expect("Foundation class");
            unsafe { msg_send![class, new] }
        }

        #[test]
        fn a_key_value_coding_exception_is_reported_instead_of_aborting() {
            // A plain NSObject has no `drawsBackground`: setValue:forKey:
            // raises NSUnknownKeyException, as a changed WKWebView could.
            let view = instance(c"NSObject");
            let result = unsafe { set_draws_background(view, true) };
            let reason = result.expect_err("the exception must surface as an error");
            assert!(
                reason.to_lowercase().contains("drawsbackground")
                    || reason.contains("NSUnknownKeyException"),
                "{reason}"
            );
            // The process is still alive and can make the call again.
            assert!(unsafe { set_draws_background(view, false) }.is_err());
        }

        #[test]
        fn a_receiver_that_accepts_the_key_is_updated() {
            // NSMutableDictionary treats any key as valid.
            let object = instance(c"NSMutableDictionary");
            unsafe { set_draws_background(object, false) }.expect("accepted key");
            let key = objc2_foundation::NSString::from_str("drawsBackground");
            let stored: *mut AnyObject = unsafe { msg_send![object, objectForKey: &*key] };
            assert!(!stored.is_null());
        }
    }
}
