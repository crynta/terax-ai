use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

use super::shell_init;

const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
const READ_BUF: usize = 16 * 1024;
// Cap on buffered-but-not-yet-flushed bytes. On overflow we discard the
// entire pending buffer and emit an SGR-reset + notice in its place.
// Dropping a partial prefix would slice a CSI sequence in half and corrupt
// xterm's screen state. 4 MiB is ~1000 full 80x24 screens.
const MAX_PENDING: usize = 4 * 1024 * 1024;
// Hard reset (ESC c) + dim notice. Written verbatim into the stream when
// we're forced to discard backlog.
const OVERFLOW_NOTICE: &[u8] =
    b"\x1bc\x1b[2m[terax: dropped output due to backpressure]\x1b[0m\r\n";

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: i32 },
}

pub struct Session {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // If the session Arc is dropped without an explicit pty_close (e.g.
        // frontend disconnected, window crashed, dev HMR), the reader/flusher
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

pub fn spawn(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<(Arc<Session>, PtySize), String> {
    let _spawn_guard = SPAWN_LOCK.lock().unwrap();

    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = shell_init::build_command(cwd)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    });

    let pending: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(READ_BUF)));
    let done = Arc::new(AtomicBool::new(false));
    let bytes_received = Arc::new(AtomicU64::new(0));
    let spawn_at = Instant::now();

    let pending_r = pending.clone();
    let bytes_received_r = bytes_received.clone();
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut dropped_bytes: u64 = 0;
            let mut logged_first = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !logged_first {
                            logged_first = true;
                            log::info!("pty first byte after {}ms", spawn_at.elapsed().as_millis());
                        }
                        bytes_received_r.fetch_add(n as u64, Ordering::Relaxed);
                        let mut g = pending_r.lock().unwrap();
                        if g.len() + n > MAX_PENDING {
                            // Discard the whole backlog rather than slicing
                            // through escape sequences. Emit a hard reset so
                            // xterm doesn't carry stale SGR/cursor state.
                            dropped_bytes += g.len() as u64;
                            g.clear();
                            g.extend_from_slice(OVERFLOW_NOTICE);
                        }
                        g.extend_from_slice(&buf[..n]);
                    }
                    Err(e) => {
                        // Normal on child exit: the slave fd is closed and
                        // read(2) returns EIO on some platforms. Kept at debug
                        // to avoid noise in the common case.
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            if dropped_bytes > 0 {
                log::warn!("pty backpressure: dropped {dropped_bytes} bytes (cap {MAX_PENDING})");
            }
        })
        .expect("spawn pty reader thread");

    let on_event_flush = on_event.clone();
    let pending_f = pending.clone();
    let done_f = done.clone();
    thread::Builder::new()
        .name("terax-pty-flusher".into())
        .spawn(move || loop {
            thread::sleep(FLUSH_INTERVAL);
            let chunk = {
                let mut g = pending_f.lock().unwrap();
                if g.is_empty() {
                    if done_f.load(Ordering::Acquire) {
                        break;
                    }
                    continue;
                }
                std::mem::take(&mut *g)
            };
            // NOTE on base64: Tauri v2 `Channel<T>` serializes via JSON;
            // `Vec<u8>` would become a JSON int array (~3× worse than base64).
            // A raw-bytes path via `InvokeResponseBody::Raw` exists but the
            // data+exit multiplex through one channel is awkward. Base64's 33%
            // overhead is trivial on local IPC — revisit if profiling says
            // otherwise.
            let event = PtyEvent::Data {
                data: B64.encode(&chunk),
            };
            if let Err(e) = on_event_flush.send(event) {
                log::debug!("pty flusher exiting, channel closed: {e}");
                break;
            }
        })
        .expect("spawn pty flusher thread");

    #[cfg(windows)]
    {
        let session_w = session.clone();
        let bytes_received_w = bytes_received.clone();
        let done_w = done.clone();
        thread::Builder::new()
            .name("terax-pty-conpty-nudge".into())
            .spawn(move || {
                let deadlines_ms: [u64; 3] = [400, 900, 1600];
                let mut elapsed = 0u64;
                for (i, deadline) in deadlines_ms.iter().enumerate() {
                    let sleep_ms = deadline - elapsed;
                    thread::sleep(Duration::from_millis(sleep_ms));
                    elapsed = *deadline;
                    if done_w.load(Ordering::Acquire) {
                        return;
                    }
                    if bytes_received_w.load(Ordering::Relaxed) > 0 {
                        return;
                    }
                    let resize_result = {
                        let mut master = match session_w.master.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        master.resize(size)
                    };
                    match resize_result {
                        Ok(()) => log::warn!(
                            "conpty stall: nudge #{} at {}ms (no output yet)",
                            i + 1,
                            deadline
                        ),
                        Err(e) => {
                            log::warn!("conpty nudge resize failed at {}ms: {e}", deadline);
                            return;
                        }
                    }
                }
                if bytes_received_w.load(Ordering::Relaxed) == 0 {
                    log::error!(
                        "conpty stall: still no output after {}ms — child may be wedged",
                        deadlines_ms[deadlines_ms.len() - 1]
                    );
                }
            })
            .expect("spawn pty conpty-nudge thread");
    }

    let on_event_exit = on_event;
    let pending_e = pending;
    let done_e = done;
    drop(bytes_received);
    thread::Builder::new()
        .name("terax-pty-waiter".into())
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            // Wait for the reader to hit EOF before taking a final snapshot of
            // `pending`, so the last line of output never races the Exit event.
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
            }
            let tail = std::mem::take(&mut *pending_e.lock().unwrap());
            if !tail.is_empty() {
                if let Err(e) = on_event_exit.send(PtyEvent::Data {
                    data: B64.encode(&tail),
                }) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            if let Err(e) = on_event_exit.send(PtyEvent::Exit { code }) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
        })
        .expect("spawn pty waiter thread");

    Ok((session, size))
}
