//! Native macOS speech recognition for the Session Reader's mic button.
//!
//! `SFSpeechRecognizer` is fed by an `AVAudioEngine` input tap; partial and
//! final transcripts go to the webview as `terax:speech` events. One session
//! runs at a time and stops on its own after a minute of silence or five
//! minutes in total. Everything else off macOS reports "unsupported".

use serde::Serialize;

/// The event every session update is sent as.
pub const SPEECH_EVENT: &str = "terax:speech";

const SILENCE_LIMIT_MS: u64 = 60_000;
const SESSION_LIMIT_MS: u64 = 5 * 60_000;
/// How long a stop waits for the recogniser's final result before cancelling.
const STOP_GRACE_MS: u64 = 2_500;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechPermission {
    /// notDetermined | denied | restricted | authorized | unsupported
    pub speech: &'static str,
    pub microphone: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEvent {
    pub session: u64,
    /// partial | final | error | end
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Accepts BCP 47-style tags such as "en-IN" or "hi-IN".
pub fn validate_lang(lang: &str) -> Result<(), String> {
    let mut parts = lang.split('-');
    let primary = parts.next().unwrap_or_default();
    let primary_ok =
        (2..=3).contains(&primary.len()) && primary.chars().all(|c| c.is_ascii_alphabetic());
    let rest_ok = parts.all(|p| {
        (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric())
    });
    if lang.len() <= 35 && primary_ok && rest_ok {
        Ok(())
    } else {
        Err(format!("invalid speech language: {lang:?}"))
    }
}

/// "en-IN" → "en_IN", the form `NSLocale` identifiers use.
pub fn locale_identifier(lang: &str) -> String {
    lang.replace('-', "_")
}

/// `SFSpeechRecognizerAuthorizationStatus` as a label.
pub fn speech_status_label(code: isize) -> &'static str {
    match code {
        0 => "notDetermined",
        1 => "denied",
        2 => "restricted",
        3 => "authorized",
        _ => "denied",
    }
}

/// `AVAuthorizationStatus` as a label.
pub fn microphone_status_label(code: isize) -> &'static str {
    match code {
        0 => "notDetermined",
        1 => "restricted",
        2 => "denied",
        3 => "authorized",
        _ => "denied",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoStop {
    /// Ask the recogniser to finish (it then sends its final result).
    Finish,
    /// The finish never completed: cancel and tear down.
    Cancel,
}

/// What the watchdog should do now, from millisecond timestamps.
pub fn auto_stop(now: u64, started: u64, last_activity: u64, stop_requested: u64) -> Option<AutoStop> {
    if stop_requested != 0 {
        return (now.saturating_sub(stop_requested) >= STOP_GRACE_MS).then_some(AutoStop::Cancel);
    }
    if now.saturating_sub(started) >= SESSION_LIMIT_MS
        || now.saturating_sub(last_activity) >= SILENCE_LIMIT_MS
    {
        return Some(AutoStop::Finish);
    }
    None
}

/// Back-to-back recognition tasks that heard nothing before a session ends.
const MAX_IDLE_RESTARTS: u32 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskDone {
    /// The utterance finished but the user is still dictating: start the next task.
    Restart,
    /// The session is over (the user stopped, or it went quiet for too long).
    End,
    /// A real failure: report it and end.
    Fail,
}

/// A recogniser error that only means the utterance ended (a pause, silence),
/// not that dictation is broken.
pub fn benign_speech_error(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    ["no speech", "retry", "request was canceled", "request was cancelled", "audio input is quiet"]
        .iter()
        .any(|needle| m.contains(needle))
}

/// What to do once a recognition task finishes, with or without an error.
pub fn after_task(stop_requested: bool, error: Option<&str>, idle_restarts: u32) -> TaskDone {
    if stop_requested {
        return TaskDone::End;
    }
    match error {
        Some(message) if !benign_speech_error(message) => TaskDone::Fail,
        _ if idle_restarts >= MAX_IDLE_RESTARTS => TaskDone::End,
        _ => TaskDone::Restart,
    }
}

#[tauri::command]
pub fn speech_permission_status() -> SpeechPermission {
    let status = platform::permission_status();
    log::info!(
        "speech: permission status speech={} microphone={}",
        status.speech,
        status.microphone
    );
    status
}

#[tauri::command]
pub async fn speech_request_permission() -> Result<SpeechPermission, String> {
    log::info!("speech: requesting permission");
    let result = tauri::async_runtime::spawn_blocking(platform::request_permission)
        .await
        .map_err(|e| format!("speech permission: {e}"))?;
    match &result {
        Ok(p) => log::info!(
            "speech: permission after request speech={} microphone={}",
            p.speech,
            p.microphone
        ),
        Err(e) => log::warn!("speech: permission request failed: {e}"),
    }
    result
}

/// Starts a session and resolves to its id; events carry the same id.
#[tauri::command]
pub async fn speech_start(app: tauri::AppHandle, lang: String) -> Result<u64, String> {
    validate_lang(&lang)?;
    let result = platform::start(app, lang.clone());
    match &result {
        Ok(id) => log::info!("speech: started session {id} ({lang})"),
        Err(e) => log::warn!("speech: start failed ({lang}): {e}"),
    }
    result
}

/// Stops listening; the final transcript and an `end` event follow.
#[tauri::command]
pub async fn speech_stop(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("speech: stop requested");
    platform::stop(app)
}

/// The System Settings privacy pane for `pane` ("microphone" | "speech").
pub fn settings_url(pane: &str) -> Option<&'static str> {
    match pane {
        "microphone" => {
            Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
        }
        "speech" => Some(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
        ),
        "keyboard" => Some("x-apple.systempreferences:com.apple.Keyboard-Settings.extension"),
        _ => None,
    }
}

/// Opens the privacy pane where Terax's microphone or speech access is granted.
#[tauri::command]
pub fn speech_open_settings(pane: String) -> Result<(), String> {
    let url = settings_url(&pane).ok_or_else(|| format!("unknown settings pane: {pane:?}"))?;
    if !cfg!(target_os = "macos") {
        return Err("unsupported".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("couldn't open System Settings: {e}"))
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{after_task, auto_stop, AutoStop, SpeechEvent, SpeechPermission, TaskDone, SPEECH_EVENT};
    use block2::RcBlock;
    use objc2::exception;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::NSString;
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Emitter};

    #[link(name = "Speech", kind = "framework")]
    extern "C" {}
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}
    #[link(name = "AVFAudio", kind = "framework")]
    extern "C" {}

    /// `AVMediaTypeAudio`.
    const MEDIA_TYPE_AUDIO: &str = "soun";

    struct Active {
        id: u64,
        engine: Retained<AnyObject>,
        request: Retained<AnyObject>,
        task: Option<Retained<AnyObject>>,
        recognizer: Retained<AnyObject>,
    }
    // SAFETY: the Objective-C objects are only touched on the main thread
    // (start, restart, stop and teardown all run there).
    unsafe impl Send for Active {}

    /// The request the microphone tap feeds; replaced when an utterance ends
    /// and the next recognition task starts on the same running engine.
    struct TapRequest(Retained<AnyObject>);
    // SAFETY: `appendAudioPCMBuffer:` is documented as callable from the audio
    // thread; the slot itself is guarded by the mutex.
    unsafe impl Send for TapRequest {}

    static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
    static TAP_REQUEST: Mutex<Option<TapRequest>> = Mutex::new(None);
    static IDLE_RESTARTS: AtomicU32 = AtomicU32::new(0);
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static CURRENT: AtomicU64 = AtomicU64::new(0);
    static STARTED: AtomicU64 = AtomicU64::new(0);
    static LAST_ACTIVITY: AtomicU64 = AtomicU64::new(0);
    static STOP_REQUESTED: AtomicU64 = AtomicU64::new(0);

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or_default()
    }

    /// Runs Objective-C that may raise, so an exception can't unwind through Rust.
    fn catch<R>(work: impl FnOnce() -> R) -> Result<R, String> {
        exception::catch(std::panic::AssertUnwindSafe(work))
            .map_err(|e| format!("Objective-C exception: {e:?}"))
    }

    fn class(name: &std::ffi::CStr) -> Result<&'static AnyClass, String> {
        AnyClass::get(name).ok_or_else(|| format!("{} is not available", name.to_string_lossy()))
    }

    fn emit(app: &AppHandle, event: SpeechEvent) {
        log::info!(
            "speech: session {} {} ({} chars){}",
            event.session,
            event.kind,
            event.text.as_deref().map_or(0, str::len),
            event.error.as_deref().map(|e| format!(" error: {e}")).unwrap_or_default()
        );
        let _ = app.emit(SPEECH_EVENT, event);
    }

    fn speech_status() -> isize {
        let Ok(cls) = class(c"SFSpeechRecognizer") else { return 1 };
        unsafe { msg_send![cls, authorizationStatus] }
    }

    fn microphone_status() -> isize {
        let Ok(cls) = class(c"AVCaptureDevice") else { return 1 };
        let media = NSString::from_str(MEDIA_TYPE_AUDIO);
        unsafe { msg_send![cls, authorizationStatusForMediaType: &*media] }
    }

    pub fn permission_status() -> SpeechPermission {
        SpeechPermission {
            speech: super::speech_status_label(speech_status()),
            microphone: super::microphone_status_label(microphone_status()),
        }
    }

    pub fn request_permission() -> Result<SpeechPermission, String> {
        if speech_status() == 0 {
            let cls = class(c"SFSpeechRecognizer")?;
            let (tx, rx) = mpsc::channel::<isize>();
            let block = RcBlock::new(move |status: isize| {
                let _ = tx.send(status);
            });
            catch(|| unsafe {
                let _: () = msg_send![cls, requestAuthorization: &*block];
            })
            .map_err(|e| format!("speech authorization raised: {e}"))?;
            let _ = rx.recv_timeout(Duration::from_secs(120));
        }
        if microphone_status() == 0 {
            let cls = class(c"AVCaptureDevice")?;
            let media = NSString::from_str(MEDIA_TYPE_AUDIO);
            let (tx, rx) = mpsc::channel::<bool>();
            let block = RcBlock::new(move |granted: Bool| {
                let _ = tx.send(granted.as_bool());
            });
            catch(|| unsafe {
                let _: () =
                    msg_send![cls, requestAccessForMediaType: &*media, completionHandler: &*block];
            })
            .map_err(|e| format!("microphone authorization raised: {e}"))?;
            let _ = rx.recv_timeout(Duration::from_secs(120));
        }
        Ok(permission_status())
    }

    fn on_main<T: Send + 'static>(
        app: &AppHandle,
        work: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(work());
        })
        .map_err(|e| format!("speech: {e}"))?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "speech: the main thread didn't answer".to_string())?
    }

    pub fn start(app: AppHandle, lang: String) -> Result<u64, String> {
        let perms = permission_status();
        if perms.speech != "authorized" {
            return Err(format!("permission:speech:{}", perms.speech));
        }
        if perms.microphone != "authorized" {
            return Err(format!("permission:microphone:{}", perms.microphone));
        }
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        let main_app = app.clone();
        on_main(&app, move || {
            teardown_current();
            begin(main_app, id, &lang)
        })?;
        spawn_watchdog(app, id);
        Ok(id)
    }

    pub fn stop(app: AppHandle) -> Result<(), String> {
        on_main(&app, || {
            finish_current();
            Ok(())
        })
    }

    /// Main thread: builds the recogniser, request, task and audio tap.
    fn begin(app: AppHandle, id: u64, lang: &str) -> Result<(), String> {
        let locale_cls = class(c"NSLocale")?;
        let recognizer_cls = class(c"SFSpeechRecognizer")?;
        let request_cls = class(c"SFSpeechAudioBufferRecognitionRequest")?;
        let engine_cls = class(c"AVAudioEngine")?;
        let ident = NSString::from_str(&super::locale_identifier(lang));

        let built = catch(|| unsafe {
            let locale: Option<Retained<AnyObject>> =
                msg_send![locale_cls, localeWithLocaleIdentifier: &*ident];
            let locale = locale?;
            let alloc: *mut AnyObject = msg_send![recognizer_cls, alloc];
            let recognizer: Option<Retained<AnyObject>> =
                Retained::from_raw(msg_send![alloc, initWithLocale: &*locale]);
            let recognizer = recognizer?;
            let request: Retained<AnyObject> = msg_send![request_cls, new];
            let engine: Retained<AnyObject> = msg_send![engine_cls, new];
            Some((recognizer, request, engine))
        })
        .map_err(|e| format!("speech setup raised: {e}"))?;
        let Some((recognizer, request, engine)) = built else {
            return Err(format!("unsupported language: {lang}"));
        };

        let available: Bool = unsafe { msg_send![&*recognizer, isAvailable] };
        if !available.as_bool() {
            return Err("speech recognition is not available right now".into());
        }

        configure_request(&recognizer, &request);
        if let Ok(mut slot) = TAP_REQUEST.lock() {
            *slot = Some(TapRequest(request.clone()));
        }

        // Audio tap → whichever request is current (it changes between utterances).
        let tap = RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
            if buffer.is_null() {
                return;
            }
            if let Ok(slot) = TAP_REQUEST.lock() {
                if let Some(current) = slot.as_ref() {
                    unsafe {
                        let _: () = msg_send![&*current.0, appendAudioPCMBuffer: buffer];
                    }
                }
            }
        });
        let input: Retained<AnyObject> = unsafe { msg_send![&*engine, inputNode] };
        let format: Retained<AnyObject> = unsafe { msg_send![&*input, outputFormatForBus: 0usize] };
        let rate: f64 = unsafe { msg_send![&*format, sampleRate] };
        let channels: u32 = unsafe { msg_send![&*format, channelCount] };
        if rate <= 0.0 || channels == 0 {
            return Err("no microphone input is available".into());
        }
        catch(|| unsafe {
            let _: () = msg_send![
                &*input,
                installTapOnBus: 0usize,
                bufferSize: 1024u32,
                format: &*format,
                block: &*tap
            ];
        })
        .map_err(|e| format!("microphone tap raised: {e}"))?;

        let handler = make_handler(app.clone(), id);
        let task: Option<Retained<AnyObject>> = unsafe {
            msg_send![&*recognizer, recognitionTaskWithRequest: &*request, resultHandler: &*handler]
        };

        unsafe {
            let _: () = msg_send![&*engine, prepare];
        }
        let mut err: *mut AnyObject = std::ptr::null_mut();
        let started: Bool = unsafe { msg_send![&*engine, startAndReturnError: &mut err] };
        if !started.as_bool() {
            unsafe {
                let _: () = msg_send![&*input, removeTapOnBus: 0usize];
                if let Some(t) = &task {
                    let _: () = msg_send![&**t, cancel];
                }
            }
            return Err("couldn't start the microphone".into());
        }

        let now = now_ms();
        CURRENT.store(id, Ordering::SeqCst);
        STARTED.store(now, Ordering::SeqCst);
        LAST_ACTIVITY.store(now, Ordering::SeqCst);
        STOP_REQUESTED.store(0, Ordering::SeqCst);
        IDLE_RESTARTS.store(0, Ordering::SeqCst);
        if let Ok(mut slot) = ACTIVE.lock() {
            *slot = Some(Active { id, engine, request, task, recognizer });
        }
        Ok(())
    }

    /// Live partials, dictation-style punctuation, and on-device recognition when offered.
    fn configure_request(recognizer: &AnyObject, request: &AnyObject) {
        unsafe {
            let _: () = msg_send![request, setShouldReportPartialResults: Bool::YES];
            // SFSpeechRecognitionTaskHintDictation
            let _: () = msg_send![request, setTaskHint: 1isize];
            let on_device: Bool = msg_send![recognizer, supportsOnDeviceRecognition];
            if on_device.as_bool() {
                let _: () = msg_send![request, setRequiresOnDeviceRecognition: Bool::YES];
            }
            let punct = objc2::sel!(setAddsPunctuation:);
            let responds: Bool = msg_send![request, respondsToSelector: punct];
            if responds.as_bool() {
                let _: () = msg_send![request, setAddsPunctuation: Bool::YES];
            }
        }
    }

    /// Recognition results for session `id` → events. When a task finishes
    /// (the recogniser closes an utterance at a pause) while the user is still
    /// dictating, the next task starts on the same engine.
    fn make_handler(app: AppHandle, id: u64) -> RcBlock<dyn Fn(*mut AnyObject, *mut AnyObject)> {
        RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
            if CURRENT.load(Ordering::SeqCst) != id {
                return;
            }
            let mut done = false;
            if !result.is_null() {
                let (text, is_final) = unsafe {
                    let best: *mut AnyObject = msg_send![result, bestTranscription];
                    let text = if best.is_null() {
                        String::new()
                    } else {
                        let s: *mut NSString = msg_send![best, formattedString];
                        if s.is_null() { String::new() } else { (*s).to_string() }
                    };
                    let fin: Bool = msg_send![result, isFinal];
                    (text, fin.as_bool())
                };
                LAST_ACTIVITY.store(now_ms(), Ordering::SeqCst);
                if !text.trim().is_empty() {
                    IDLE_RESTARTS.store(0, Ordering::SeqCst);
                }
                if is_final {
                    log::info!("speech: session {id} segment commit ({} chars)", text.len());
                }
                emit(
                    &app,
                    SpeechEvent {
                        session: id,
                        kind: if is_final { "final" } else { "partial" },
                        text: Some(text),
                        error: None,
                    },
                );
                done = is_final;
            }
            let mut message = None;
            if !error.is_null() && !done {
                message = Some(unsafe {
                    let d: *mut NSString = msg_send![error, localizedDescription];
                    if d.is_null() { "speech recognition failed".to_string() } else { (*d).to_string() }
                });
                done = true;
            }
            if !done {
                return;
            }
            let stopped = STOP_REQUESTED.load(Ordering::SeqCst) != 0;
            match after_task(stopped, message.as_deref(), IDLE_RESTARTS.load(Ordering::SeqCst)) {
                TaskDone::Restart => {
                    IDLE_RESTARTS.fetch_add(1, Ordering::SeqCst);
                    let next_app = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Err(e) = restart_task(&next_app, id) {
                            log::warn!("speech: session {id} couldn't continue: {e}");
                            end_session(&next_app, id);
                        }
                    });
                }
                TaskDone::End => end_session(&app, id),
                TaskDone::Fail => {
                    emit(&app, SpeechEvent { session: id, kind: "error", text: None, error: message });
                    end_session(&app, id);
                }
            }
        })
    }

    /// Main thread: a fresh request and task for the next utterance of session `id`.
    fn restart_task(app: &AppHandle, id: u64) -> Result<(), String> {
        if CURRENT.load(Ordering::SeqCst) != id || STOP_REQUESTED.load(Ordering::SeqCst) != 0 {
            return Err("session no longer listening".into());
        }
        let request_cls = class(c"SFSpeechAudioBufferRecognitionRequest")?;
        let mut slot = ACTIVE.lock().map_err(|_| "speech state is poisoned".to_string())?;
        let active = slot.as_mut().filter(|a| a.id == id).ok_or("session is gone")?;
        let request: Retained<AnyObject> = catch(|| unsafe { msg_send![request_cls, new] })
            .map_err(|e| format!("new request raised: {e}"))?;
        configure_request(&active.recognizer, &request);
        if let Ok(mut tap) = TAP_REQUEST.lock() {
            *tap = Some(TapRequest(request.clone()));
        }
        let handler = make_handler(app.clone(), id);
        let task: Option<Retained<AnyObject>> = catch(|| unsafe {
            msg_send![&*active.recognizer, recognitionTaskWithRequest: &*request, resultHandler: &*handler]
        })
        .map_err(|e| format!("new task raised: {e}"))?;
        active.request = request;
        active.task = task;
        log::info!("speech: session {id} continuing with a new utterance");
        Ok(())
    }

    /// Main thread: stop recording and let the recogniser deliver its final result.
    fn finish_current() {
        let Ok(slot) = ACTIVE.lock() else { return };
        let Some(active) = slot.as_ref() else { return };
        if STOP_REQUESTED.load(Ordering::SeqCst) != 0 {
            return;
        }
        STOP_REQUESTED.store(now_ms(), Ordering::SeqCst);
        unsafe {
            let input: Retained<AnyObject> = msg_send![&*active.engine, inputNode];
            let _: () = msg_send![&*input, removeTapOnBus: 0usize];
            let _: () = msg_send![&*active.engine, stop];
            let _: () = msg_send![&*active.request, endAudio];
        }
        if let Ok(mut tap) = TAP_REQUEST.lock() {
            *tap = None;
        }
    }

    /// Main thread: release everything for the current session, cancelling its task.
    fn teardown_current() {
        let taken = ACTIVE.lock().ok().and_then(|mut slot| slot.take());
        let Some(active) = taken else { return };
        CURRENT.store(0, Ordering::SeqCst);
        if let Ok(mut tap) = TAP_REQUEST.lock() {
            *tap = None;
        }
        unsafe {
            let input: Retained<AnyObject> = msg_send![&*active.engine, inputNode];
            let _: () = msg_send![&*input, removeTapOnBus: 0usize];
            let _: () = msg_send![&*active.engine, stop];
            let _: () = msg_send![&*active.request, endAudio];
            if let Some(task) = &active.task {
                let _: () = msg_send![&**task, cancel];
            }
        }
        drop(active);
    }

    /// Any thread: end session `id` once (emits `end`).
    fn end_session(app: &AppHandle, id: u64) {
        if CURRENT.compare_exchange(id, 0, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }
        emit(app, SpeechEvent { session: id, kind: "end", text: None, error: None });
        // CURRENT is already 0, so the handler ignores the cancel's callback.
        let _ = app.run_on_main_thread(move || {
            let mine = ACTIVE
                .lock()
                .ok()
                .is_some_and(|slot| slot.as_ref().is_some_and(|a| a.id == id));
            if mine {
                teardown_current();
            }
        });
    }

    fn spawn_watchdog(app: AppHandle, id: u64) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            if CURRENT.load(Ordering::SeqCst) != id {
                return;
            }
            let action = auto_stop(
                now_ms(),
                STARTED.load(Ordering::SeqCst),
                LAST_ACTIVITY.load(Ordering::SeqCst),
                STOP_REQUESTED.load(Ordering::SeqCst),
            );
            match action {
                Some(AutoStop::Finish) => {
                    let _ = app.run_on_main_thread(finish_current);
                }
                Some(AutoStop::Cancel) => {
                    end_session(&app, id);
                    return;
                }
                None => {}
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::SpeechPermission;

    pub fn permission_status() -> SpeechPermission {
        SpeechPermission { speech: "unsupported", microphone: "unsupported" }
    }
    pub fn request_permission() -> Result<SpeechPermission, String> {
        Ok(permission_status())
    }
    pub fn start(_app: tauri::AppHandle, _lang: String) -> Result<u64, String> {
        Err("unsupported".into())
    }
    pub fn stop(_app: tauri::AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_and_rejects_languages() {
        for ok in ["en-IN", "en-US", "hi-IN", "en", "zh-Hans-CN"] {
            assert!(validate_lang(ok).is_ok(), "{ok}");
        }
        for bad in ["", "e", "english", "en_IN", "en-", "en-I", "../etc", "en-IN;rm", &"a".repeat(40)] {
            assert!(validate_lang(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn settings_panes_are_a_fixed_list() {
        assert!(settings_url("microphone").unwrap().ends_with("Privacy_Microphone"));
        assert!(settings_url("speech").unwrap().ends_with("Privacy_SpeechRecognition"));
        assert_eq!(
            settings_url("keyboard"),
            Some("x-apple.systempreferences:com.apple.Keyboard-Settings.extension")
        );
        assert_eq!(settings_url("camera"), None);
        assert_eq!(settings_url("microphone; rm -rf /"), None);
    }

    #[test]
    fn maps_locale_identifiers() {
        assert_eq!(locale_identifier("en-IN"), "en_IN");
        assert_eq!(locale_identifier("hi"), "hi");
    }

    #[test]
    fn labels_permission_codes() {
        assert_eq!(speech_status_label(0), "notDetermined");
        assert_eq!(speech_status_label(3), "authorized");
        assert_eq!(speech_status_label(1), "denied");
        assert_eq!(microphone_status_label(2), "denied");
        assert_eq!(microphone_status_label(1), "restricted");
        assert_eq!(microphone_status_label(3), "authorized");
    }

    #[test]
    fn utterance_end_continues_dictation_until_the_user_stops() {
        // A pause closes the utterance: keep listening.
        assert_eq!(after_task(false, None, 0), TaskDone::Restart);
        assert_eq!(after_task(false, Some("No speech detected"), 3), TaskDone::Restart);
        assert_eq!(after_task(false, Some("Retry"), 0), TaskDone::Restart);
        // The user stopped: end, even with a benign or real error.
        assert_eq!(after_task(true, None, 0), TaskDone::End);
        assert_eq!(after_task(true, Some("Siri and Dictation are disabled"), 0), TaskDone::End);
        // Real failures are reported.
        assert_eq!(after_task(false, Some("Siri and Dictation are disabled"), 0), TaskDone::Fail);
        // Endless silence ends the session instead of restarting forever.
        assert_eq!(after_task(false, None, MAX_IDLE_RESTARTS), TaskDone::End);
        assert_eq!(after_task(false, Some("No speech detected"), MAX_IDLE_RESTARTS), TaskDone::End);
    }

    #[test]
    fn recognises_benign_utterance_errors() {
        assert!(benign_speech_error("No speech detected"));
        assert!(benign_speech_error("Recognition request was canceled"));
        assert!(!benign_speech_error("Siri and Dictation are disabled"));
        assert!(!benign_speech_error("speech recognition failed"));
    }

    #[test]
    fn watchdog_finishes_on_silence_or_limit_and_cancels_stuck_stops() {
        let t0 = 1_000_000;
        assert_eq!(auto_stop(t0 + 5_000, t0, t0 + 4_000, 0), None);
        assert_eq!(auto_stop(t0 + 61_000, t0, t0, 0), Some(AutoStop::Finish));
        assert_eq!(auto_stop(t0 + 300_000, t0, t0 + 299_000, 0), Some(AutoStop::Finish));
        assert_eq!(auto_stop(t0 + 1_000, t0, t0, t0), None);
        assert_eq!(auto_stop(t0 + 2_500, t0, t0, t0), Some(AutoStop::Cancel));
    }
}
