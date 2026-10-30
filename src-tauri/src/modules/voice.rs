use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod platform {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use std::ptr::NonNull;
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter};

    const KEY_CODE_FN: u16 = 63;

    static MONITOR: Mutex<Option<usize>> = Mutex::new(None);

    fn install(app: &AppHandle) {
        let mut slot = MONITOR.lock().expect("voice monitor mutex poisoned");
        if slot.is_some() {
            return;
        }
        let emitter = app.clone();
        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let (key_code, is_down) = unsafe {
                let e = event.as_ref();
                (
                    e.keyCode(),
                    e.modifierFlags().contains(NSEventModifierFlags::Function),
                )
            };
            if key_code == KEY_CODE_FN {
                let _ = emitter.emit(
                    if is_down { "voice://fn-down" } else { "voice://fn-up" },
                    (),
                );
            }
            event.as_ptr()
        });
        let monitor = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged, &block)
        };
        if let Some(monitor) = monitor {
            *slot = Some(Retained::into_raw(monitor) as usize);
        }
    }

    fn uninstall() {
        let mut slot = MONITOR.lock().expect("voice monitor mutex poisoned");
        let Some(ptr) = slot.take() else {
            return;
        };
        unsafe {
            if let Some(monitor) = Retained::from_raw(ptr as *mut AnyObject) {
                NSEvent::removeMonitor(&monitor);
            }
        }
    }

    pub fn set_fn_monitor(app: &AppHandle, enabled: bool) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if enabled {
                install(&handle);
            } else {
                uninstall();
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    pub fn set_fn_monitor(_app: &AppHandle, _enabled: bool) {}
}

#[tauri::command]
pub fn voice_set_fn_monitor(app: AppHandle, enabled: bool) {
    platform::set_fn_monitor(&app, enabled);
}
