use tauri::AppHandle;

/// File paths currently on the system clipboard (e.g. after copying in Finder,
/// Explorer or a Linux file manager), in clipboard order. Empty when the
/// clipboard holds no files.
///
/// Read on the main thread: GTK's clipboard only works there, and AppKit and
/// Win32 are happiest there too. Async so the caller never blocks that thread
/// while waiting on the result.
#[tauri::command]
pub async fn fs_clipboard_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(platform::read_file_paths());
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "clipboard read was cancelled".to_string())
}

/// The `file:` URIs in a `text/uri-list` or `x-special/gnome-copied-files`
/// payload; skips the latter's leading `copy`/`cut` verb and uri-list comments.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn file_uri_lines(text: &str) -> impl Iterator<Item = &str> {
    text.lines()
        .map(str::trim)
        .filter(|line| line.starts_with("file:"))
}

#[cfg(target_os = "macos")]
mod platform {
    use crate::modules::fs::to_canon;
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    pub fn read_file_paths() -> Vec<String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let Some(items) = pasteboard.pasteboardItems() else {
            return Vec::new();
        };
        let file_type = unsafe { NSPasteboardTypeFileURL };
        items
            .iter()
            .filter_map(|item| {
                let raw = item.stringForType(file_type)?;
                let url = NSURL::URLWithString(&raw)?;
                // Finder publishes file-reference URLs (file:///.file/id=…);
                // filePathURL resolves them to the real path.
                let path = url.filePathURL()?.path()?.to_string();
                (!path.is_empty()).then(|| to_canon(path))
            })
            .collect()
    }
}

#[cfg(windows)]
mod platform {
    use crate::modules::fs::to_canon;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    // Another app may hold the clipboard open for a moment; retry briefly.
    fn open_clipboard() -> bool {
        for _ in 0..5 {
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    pub fn read_file_paths() -> Vec<String> {
        if !open_clipboard() {
            log::warn!("fs_clipboard_paths: clipboard is busy");
            return Vec::new();
        }
        let mut paths = Vec::new();
        // The handle is owned by the clipboard; it must not be freed here.
        let hdrop = unsafe { GetClipboardData(u32::from(CF_HDROP)) };
        if !hdrop.is_null() {
            let count = unsafe { DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0) };
            for index in 0..count {
                let len = unsafe { DragQueryFileW(hdrop, index, std::ptr::null_mut(), 0) };
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len as usize + 1];
                let written =
                    unsafe { DragQueryFileW(hdrop, index, buf.as_mut_ptr(), buf.len() as u32) };
                buf.truncate(written as usize);
                if !buf.is_empty() {
                    paths.push(to_canon(OsString::from_wide(&buf)));
                }
            }
        }
        unsafe { CloseClipboard() };
        paths
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use crate::modules::fs::to_canon;
    use gtk::{gdk, glib};

    pub fn read_file_paths() -> Vec<String> {
        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        // `wait_*` runs a nested main loop until the clipboard owner answers.
        let mut uris: Vec<String> = clipboard
            .wait_for_uris()
            .iter()
            .map(|uri| uri.to_string())
            .collect();
        if uris.is_empty() {
            // Some file managers only offer GNOME's private target.
            let target = gdk::Atom::intern("x-special/gnome-copied-files");
            if let Some(selection) = clipboard.wait_for_contents(&target) {
                let text = String::from_utf8_lossy(&selection.data()).into_owned();
                uris = super::file_uri_lines(&text).map(str::to_owned).collect();
            }
        }
        uris.iter()
            .filter_map(|uri| glib::filename_from_uri(uri).ok())
            .map(|(path, _host)| to_canon(path))
            .collect()
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod platform {
    pub fn read_file_paths() -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::file_uri_lines;

    #[test]
    fn file_uri_lines_reads_gnome_and_uri_list_payloads() {
        let gnome = "copy\nfile:///home/a/x.txt\nfile:///home/a/My%20Dir";
        assert_eq!(
            file_uri_lines(gnome).collect::<Vec<_>>(),
            ["file:///home/a/x.txt", "file:///home/a/My%20Dir"]
        );
        let uri_list = "# comment\r\nfile:///tmp/a\r\nhttps://example.com\r\n\r\n";
        assert_eq!(
            file_uri_lines(uri_list).collect::<Vec<_>>(),
            ["file:///tmp/a"]
        );
    }
}
