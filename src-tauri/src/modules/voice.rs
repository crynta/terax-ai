use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn install_fn_monitor(app: &AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use std::ptr::NonNull;
    use tauri::Emitter;

    const KEY_CODE_FN: u16 = 63;

    let handle = app.clone();
    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let (key_code, is_down) = unsafe {
            let e = event.as_ref();
            (
                e.keyCode(),
                e.modifierFlags().contains(NSEventModifierFlags::Function),
            )
        };
        if key_code == KEY_CODE_FN {
            let _ = handle.emit(
                if is_down { "voice://fn-down" } else { "voice://fn-up" },
                (),
            );
        }
        event.as_ptr()
    });

    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &block)
    };
    std::mem::forget(monitor);
}

#[cfg(not(target_os = "macos"))]
pub fn install_fn_monitor(_app: &AppHandle) {}
