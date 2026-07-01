use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};

use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terax:agent-signal";

// Flusher coalesces a short window after first-byte arrival so we send chunks,
// not single bytes. MAX_IDLE is only a safety net for missed signals.
const FLUSH_COALESCE: Duration = Duration::from_millis(4);
const FLUSH_MAX_IDLE: Duration = Duration::from_millis(50);
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
// Cap on bytes queued for the PTY input writer. A stuck PTY (child hung, pipe
// full) would otherwise let pty_write accumulate unbounded Vec<u8>s in memory;
// once exceeded, pty_write returns a backpressure error instead of queuing.
// 16 MiB is far above any realistic keystroke burst or paste.
pub(super) const WRITE_QUEUE_CAP: usize = 16 * 1024 * 1024;

pub struct Session {
    // Field drop order is intentional. Rust drops fields top-to-bottom:
    //   1. `_job`: on Windows, closing the Job HANDLE fires
    //      KILL_ON_JOB_CLOSE, terminating the pwsh tree before the master
    //      pipe drops. Without this, ClosePseudoConsole in `master`'s Drop
    //      can block waiting for conhost to drain pending output, freezing
    //      the Tauri worker thread that triggered the close.
    //   2. `killer`: best-effort kill (redundant on Windows once Job
    //      closed, but harmless and required on Unix where there is no Job).
    //   3. `write_tx`: drops the last channel sender, so the dedicated
    //      writer thread drains and exits, releasing the input-side writer
    //      clone it holds. (The reader thread's writer clone, used for DA
    //      replies, is released when the killed child's EOF unwinds it.)
    //   4. `master`: last; ClosePseudoConsole on Windows. By now the child
    //      is dead and conhost has nothing left to drain.
    #[cfg(windows)]
    _job: Option<super::job::PtyJob>,
    /// PID of the shell process. 0 means unknown; callers must skip checks when 0.
    pub shell_pid: u32,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    // Input bytes are queued here and drained by a single dedicated writer
    // thread, so a burst of pty_write calls stays in arrival order rather than
    // racing for the writer lock from independent spawn_blocking jobs.
    pub write_tx: Sender<Vec<u8>>,
    // Bytes currently queued in write_tx but not yet written. Bounded by
    // WRITE_QUEUE_CAP: pty_write refuses to enqueue past the cap so a stuck
    // PTY can't grow memory unbounded.
    pub queued_bytes: Arc<AtomicUsize>,
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    // Set by the waiter once the child exits, so pty_open can reap a shell
    // that died before it was registered.
    pub(super) exited: Arc<AtomicBool>,
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
// Serializes ConPTY create and close: overlapping pseudoconsole lifecycle
// calls corrupt the new console so its shell never pumps output (issue #356).
#[cfg(windows)]
static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

pub(super) fn drop_session(session: Arc<Session>) {
    #[cfg(windows)]
    let _guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();
    drop(session);
}

struct ChildKillGuard {
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
}

impl ChildKillGuard {
    fn new(killer: Box<dyn ChildKiller + Send + Sync>) -> Self {
        Self { killer: Some(killer) }
    }

    fn disarm(&mut self) {
        self.killer = None;
    }
}

impl Drop for ChildKillGuard {
    fn drop(&mut self) {
        if let Some(mut k) = self.killer.take() {
            let _ = k.kill();
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: u32,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    shell: Option<String>,
    on_data: Channel<Response>,
    on_exit: Channel<i32>,
) -> Result<(Arc<Session>, PtySize), String> {
    #[cfg(windows)]
    let _spawn_guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();

    let pty_system = native_pty_system();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = shell_init::build_command(cwd, workspace, blocks, shell)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    // Kill the child if any of the pipe setup below fails so the spawned shell
    // can't outlive an aborted pty_open.
    let mut guard = ChildKillGuard::new(child.clone_killer());
    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    guard.disarm();

    // Dedicated writer thread: serializes all input writes in arrival order so
    // concurrent pty_write calls can't reach the writer lock out of order and
    // scramble a fast burst of keystrokes. The channel is byte-bounded (see
    // queued_bytes / WRITE_QUEUE_CAP); pty_write applies backpressure instead
    // of letting a stuck PTY accumulate unbounded input. The thread exits when
    // the last sender drops (session close) or a write/lock fails: breaking
    // drops the receiver so later sends return a channel-closed error rather
    // than silently discarding input.
    let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>();
    let writer_for_writer = writer.clone();
    let queued_bytes = Arc::new(AtomicUsize::new(0));
    let queued_bytes_writer = queued_bytes.clone();
    thread::Builder::new()
        .name("terax-pty-writer".into())
        .spawn(move || {
            for bytes in write_rx {
                let len = bytes.len();
                let ok = match writer_for_writer.lock() {
                    Ok(mut w) => w.write_all(&bytes).is_ok(),
                    Err(_) => false,
                };
                queued_bytes_writer.fetch_sub(len, Ordering::Relaxed);
                if !ok {
                    log::debug!("pty writer thread stopping after write/lock failure");
                    break;
                }
            }
        })
        .expect("spawn pty writer thread");

    let shell_pid = child.process_id().unwrap_or(0);

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

    let exited = Arc::new(AtomicBool::new(false));

    let session = Arc::new(Session {
        #[cfg(windows)]
        _job: job,
        shell_pid,
        killer: Mutex::new(killer),
        write_tx,
        queued_bytes,
        master: Mutex::new(pair.master),
        exited: exited.clone(),
    });

    let pending: Arc<(Mutex<Vec<u8>>, Condvar)> = Arc::new((
        Mutex::new(Vec::with_capacity(READ_BUF)),
        Condvar::new(),
    ));
    let done = Arc::new(AtomicBool::new(false));
    let spawn_at = Instant::now();

    let first_byte = Arc::new(AtomicBool::new(false));

    let pending_r = pending.clone();
    let writer_for_da = writer.clone();
    let app_reader = app.clone();
    let first_byte_r = first_byte;
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
            let mut dropped_bytes: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if !first_byte_r.load(Ordering::Relaxed) {
                            first_byte_r.store(true, Ordering::Release);
                            log::debug!("pty first byte after {}ms", spawn_at.elapsed().as_millis());
                        }
                        agent_detect.process(&buf[..n], |t| {
                            let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
                        });
                        filtered.clear();
                        da_filter.process(&buf[..n], &mut filtered, |reply| {
                            if let Ok(mut w) = writer_for_da.lock() {
                                let _ = w.write_all(reply);
                            }
                        });
                        if filtered.is_empty() {
                            continue;
                        }
                        let (lock, cv) = &*pending_r;
                        let mut g = lock.lock().unwrap();
                        if g.len() + filtered.len() > MAX_PENDING {
                            dropped_bytes += g.len() as u64;
                            g.clear();
                            g.extend_from_slice(OVERFLOW_NOTICE);
                        }
                        g.extend_from_slice(&filtered);
                        cv.notify_one();
                    }
                    Err(e) => {
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(|t| {
                let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
            });
            pending_r.1.notify_one();
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
            let (lock, cv) = &*pending_f;
            loop {
                {
                    let mut g = lock.lock().unwrap();
                    while g.is_empty() {
                        if done_f.load(Ordering::Acquire) {
                            return;
                        }
                        let (next, _) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
                        g = next;
                    }
                }
                // Coalesce a short window so a burst flushes as one chunk.
                thread::sleep(FLUSH_COALESCE);
                let chunk = std::mem::take(&mut *lock.lock().unwrap());
                if chunk.is_empty() {
                    continue;
                }
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
    let app_waiter = app;
    let exited_w = exited;
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
            exited_w.store(true, Ordering::Release);
            // Wait for the reader to hit EOF before taking a final snapshot of
            // `pending`, so the last line of output never races the Exit event.
            #[cfg(windows)]
            {
                let deadline = Instant::now() + Duration::from_millis(50);
                while Instant::now() < deadline && !reader_thread.is_finished() {
                    thread::sleep(Duration::from_millis(5));
                }
            }
            #[cfg(not(windows))]
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
            }
            let (lock, cv) = &*pending_e;
            let tail = std::mem::take(&mut *lock.lock().unwrap());
            if !tail.is_empty() {
                if let Err(e) = on_data_exit.send(Response::new(tail)) {
                    log::debug!("pty final-data send failed (channel closed): {e}");
                }
            }
            done_e.store(true, Ordering::Release);
            cv.notify_all();
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            if let Some(state) = app_waiter.try_state::<super::PtyState>() {
                if let Some(s) = state.take(id) {
                    drop_session(s);
                }
            }
        })
        .expect("spawn pty waiter thread");

    Ok((session, size))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    #[test]
    fn drop_kills_child_process() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("sleep 30");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let killer = child.clone_killer();
        // take_writer so the writer side is owned and dropped with the test,
        // but the Session no longer stores it directly.
        drop(pair.master.take_writer().expect("writer"));

        let session = Arc::new(Session {
            shell_pid: child.process_id().unwrap_or(0),
            killer: Mutex::new(killer),
            write_tx: mpsc::channel().0,
            queued_bytes: Arc::new(AtomicUsize::new(0)),
            master: Mutex::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
        });

        assert!(
            child.try_wait().unwrap().is_none(),
            "child must be alive before drop",
        );

        drop(session);

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut exited = false;
        while Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(exited, "child still running 2s after Session drop");
    }

    #[test]
    fn drop_session_succeeds_after_child_already_exited() {
        let pty_system = native_pty_system();
        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).expect("openpty");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("exit 0");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);
        let _ = child.wait();

        let killer = child.clone_killer();
        drop(pair.master.take_writer().expect("writer"));

        let session = Arc::new(Session {
            shell_pid: 0,
            killer: Mutex::new(killer),
            write_tx: mpsc::channel().0,
            queued_bytes: Arc::new(AtomicUsize::new(0)),
            master: Mutex::new(pair.master),
            exited: Arc::new(AtomicBool::new(false)),
        });

        drop_session(session);
    }
}
