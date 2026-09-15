use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize)]
pub struct PresentationSnapshot {
    revision: u64,
    occluded: bool,
    sleeping: bool,
}

#[cfg(any(target_os = "macos", test))]
impl PresentationSnapshot {
    fn update(&mut self, occluded: Option<bool>, sleeping: Option<bool>) -> Option<Self> {
        let occluded = occluded.unwrap_or(self.occluded);
        let sleeping = sleeping.unwrap_or(self.sleeping);
        if self.occluded == occluded && self.sleeping == sleeping {
            return None;
        }
        self.occluded = occluded;
        self.sleeping = sleeping;
        self.revision += 1;
        Some(*self)
    }
}

#[derive(Default)]
pub struct WindowPresentationState(Mutex<PresentationSnapshot>);

#[tauri::command]
pub fn window_presentation_state(
    state: State<'_, WindowPresentationState>,
) -> PresentationSnapshot {
    *state.0.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(target_os = "macos")]
pub mod macos {
    use super::WindowPresentationState;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSWindow, NSWindowDidChangeOcclusionStateNotification, NSWindowOcclusionState, NSWorkspace,
        NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue,
    };
    use std::cell::RefCell;
    use std::ptr::NonNull;
    use tauri::{AppHandle, Emitter, Manager};

    struct Observer {
        center: Retained<NSNotificationCenter>,
        token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }

    impl Drop for Observer {
        fn drop(&mut self) {
            unsafe { self.center.removeObserver((*self.token).as_ref()) };
        }
    }

    thread_local! {
        static OBSERVERS: RefCell<Vec<Observer>> = const { RefCell::new(Vec::new()) };
    }

    fn occluded(app: &AppHandle) -> Option<bool> {
        let window = app.get_webview_window("main")?;
        let pointer = window.ns_window().ok()?;
        // Tauri owns this NSWindow; notification callbacks run on the main queue.
        let native = unsafe { &*pointer.cast::<NSWindow>() };
        Some(
            !native
                .occlusionState()
                .contains(NSWindowOcclusionState::Visible),
        )
    }

    fn update(app: &AppHandle, sleeping: Option<bool>) {
        let occluded = occluded(app);
        let state = app.state::<WindowPresentationState>();
        let next = state
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .update(occluded, sleeping);
        if let (Some(next), Some(window)) = (next, app.get_webview_window("main")) {
            let _ = window.emit("terax:window-presentation", next);
        }
    }

    pub fn install(app: &AppHandle) {
        uninstall();
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        let native = unsafe { &*pointer.cast::<NSWindow>() };
        let queue = NSOperationQueue::mainQueue();
        let center = NSNotificationCenter::defaultCenter();
        let handle = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| update(&handle, None));
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidChangeOcclusionStateNotification),
                Some(native),
                Some(&queue),
                &block,
            )
        };
        OBSERVERS.with_borrow_mut(|observers| observers.push(Observer { center, token }));
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        for (name, sleeping) in unsafe {
            [
                (NSWorkspaceWillSleepNotification, true),
                (NSWorkspaceDidWakeNotification, false),
            ]
        } {
            let handle = app.clone();
            let block =
                RcBlock::new(move |_: NonNull<NSNotification>| update(&handle, Some(sleeping)));
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    None,
                    Some(&queue),
                    &block,
                )
            };
            OBSERVERS.with_borrow_mut(|observers| {
                observers.push(Observer {
                    center: center.clone(),
                    token,
                })
            });
        }
        update(app, None);
    }

    pub fn uninstall() {
        OBSERVERS.with_borrow_mut(Vec::clear);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_notifications_are_deduplicated_and_ordered() {
        let mut state = PresentationSnapshot::default();
        assert_eq!(state.update(Some(true), None).unwrap().revision, 1);
        for _ in 0..10_000 {
            assert!(state.update(Some(true), None).is_none());
        }
        assert_eq!(state.update(None, Some(true)).unwrap().revision, 2);
        assert_eq!(state.update(Some(false), Some(false)).unwrap().revision, 3);
        assert!(!state.occluded && !state.sleeping);
    }
}
