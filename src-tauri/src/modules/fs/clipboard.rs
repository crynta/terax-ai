use tauri::AppHandle;

#[tauri::command]
pub async fn fs_clipboard_paths(app: AppHandle) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(platform::read_file_paths)
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            #[cfg(target_os = "linux")]
            platform::request_file_paths(tx);
            #[cfg(not(target_os = "linux"))]
            let _ = tx.send(platform::read_file_paths());
        })
        .map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(std::time::Duration::from_secs(5))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "clipboard read timed out or was cancelled".to_string())?
    }
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

    pub fn read_file_paths() -> Result<Vec<String>, String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let Some(items) = pasteboard.pasteboardItems() else {
            return Ok(Vec::new());
        };
        let file_type = unsafe { NSPasteboardTypeFileURL };
        Ok(items
            .iter()
            .filter_map(|item| {
                let raw = item.stringForType(file_type)?;
                let url = NSURL::URLWithString(&raw)?;
                // Finder publishes file-reference URLs (file:///.file/id=…);
                // filePathURL resolves them to the real path.
                let path = url.filePathURL()?.path()?.to_string();
                (!path.is_empty()).then(|| to_canon(path))
            })
            .collect())
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

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    pub fn read_file_paths() -> Result<Vec<String>, String> {
        if !open_clipboard() {
            return Err("clipboard is busy; try pasting again".into());
        }
        let _guard = ClipboardGuard;
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
        Ok(paths)
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use crate::modules::fs::to_canon;
    use gtk::{gdk, glib};

    fn local_paths(uris: &[glib::GString]) -> Vec<String> {
        uris.iter()
            .filter_map(|uri| glib::filename_from_uri(uri).ok())
            .filter(|(_, host)| {
                host.as_deref()
                    .is_none_or(|host| host.is_empty() || host.eq_ignore_ascii_case("localhost"))
            })
            .map(|(path, _)| to_canon(path))
            .collect()
    }

    pub fn request_file_paths(tx: std::sync::mpsc::Sender<Result<Vec<String>, String>>) {
        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        clipboard.request_uris(move |clipboard, uris| {
            if !uris.is_empty() {
                let _ = tx.send(Ok(local_paths(uris)));
                return;
            }
            clipboard.request_contents(
                &gdk::Atom::intern("x-special/gnome-copied-files"),
                move |_, selection| {
                    if selection.length() <= 0 {
                        let _ = tx.send(Ok(Vec::new()));
                        return;
                    }
                    let text = String::from_utf8_lossy(&selection.data()).into_owned();
                    let uris: Vec<glib::GString> =
                        super::file_uri_lines(&text).map(Into::into).collect();
                    let _ = tx.send(Ok(local_paths(&uris)));
                },
            );
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn decodes_local_uris_without_treating_remote_hosts_as_local_paths() {
            let uris: Vec<glib::GString> = [
                "file:///tmp/My%20File",
                "file://localhost/tmp/local",
                "file://remote-server/tmp/remote",
                "https://example.com/file",
            ]
            .into_iter()
            .map(Into::into)
            .collect();
            assert_eq!(local_paths(&uris), ["/tmp/My File", "/tmp/local"]);
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod platform {
    pub fn read_file_paths() -> Result<Vec<String>, String> {
        Ok(Vec::new())
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
