use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};

use super::shell_init;

const POLL_INTERVAL: Duration = Duration::from_millis(4);
const BURST_MAX_AGE: Duration = Duration::from_millis(16);
const BURST_THRESHOLD: usize = 64 * 1024;
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

pub struct Session {
    // Field drop order is intentional. Rust drops fields top-to-bottom:
    //   1. `_job` — on Windows, closing the Job HANDLE fires
    //      KILL_ON_JOB_CLOSE, terminating the pwsh tree before the master
    //      pipe drops. Without this, ClosePseudoConsole in `master`'s Drop
    //      can block waiting for conhost to drain pending output, freezing
    //      the Tauri worker thread that triggered the close.
    //   2. `killer` — best-effort kill (redundant on Windows once Job
    //      closed, but harmless and required on Unix where there is no Job).
    //   3. `writer` — closes the input side of the master pipe.
    //   4. `master` — last; ClosePseudoConsole on Windows. By now the child
    //      is dead and conhost has nothing left to drain.
    #[cfg(windows)]
    _job: Option<super::job::PtyJob>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    /// PID of the spawned shell process. Captured before `child` is moved into the
    /// waiter thread so platform-specific introspection (e.g. `/proc/<pid>/cwd`) can
    /// resolve the live CWD long after spawn. `None` when the platform doesn't expose
    /// a usable PID — keep callers defensive.
    pub child_pid: Option<u32>,
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
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
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
    // Snapshot the PID now; the `child` handle is moved into the waiter thread below
    // and there's no second chance after that point.
    let child_pid = child.process_id();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    #[cfg(windows)]
    let job = match child.process_id() {
        Some(pid) => match super::job::PtyJob::create_for(pid) {
            Ok(j) => Some(j),
            Err(e) => {
                log::warn!("pty job-object setup failed for pid={pid}: {e}");
                None
            }
        },
        None => None,
    };

    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        killer: Mutex::new(killer),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child_pid,
    });

    let pending: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(READ_BUF)));
    let done = Arc::new(AtomicBool::new(false));
    let spawn_at = Instant::now();

    let pending_r = pending.clone();
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

    let on_data_flush = on_data.clone();
    let pending_f = pending.clone();
    let done_f = done.clone();
    thread::Builder::new()
        .name("terax-pty-flusher".into())
        .spawn(move || {
            let mut idle = true;
            let mut batch_started = Instant::now();
            loop {
                thread::sleep(POLL_INTERVAL);
                let chunk = {
                    let mut g = pending_f.lock().unwrap();
                    if g.is_empty() {
                        idle = true;
                        if done_f.load(Ordering::Acquire) {
                            break;
                        }
                        continue;
                    }
                    if idle {
                        // First chunk after idle: drain now for snappy
                        // prompt/keystroke echo latency.
                        idle = false;
                    } else if g.len() < BURST_THRESHOLD && batch_started.elapsed() < BURST_MAX_AGE {
                        // Still in a burst — keep accumulating.
                        continue;
                    }
                    batch_started = Instant::now();
                    std::mem::take(&mut *g)
                };
                // Raw bytes — arrives in JS as ArrayBuffer, no base64/JSON.
                if let Err(e) = on_data_flush.send(Response::new(chunk)) {
                    log::debug!("pty flusher exiting, channel closed: {e}");
                    break;
                }
            }
        })
        .expect("spawn pty flusher thread");

    let on_data_exit = on_data;
    let pending_e = pending;
    let done_e = done;
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
                if let Err(e) = on_data_exit.send(Response::new(tail)) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
        })
        .expect("spawn pty waiter thread");

    Ok((session, size))
}
