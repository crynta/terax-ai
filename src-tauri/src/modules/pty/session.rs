use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager};

use super::agent_detect::AgentDetector;
use super::da_filter::DaFilter;
use super::output::{OutputCredit, MAX_BUFFERED_BYTES};
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terax:agent-signal";

// Sparse output keeps low interactive latency. Sustained output is aligned to
// the display cadence so IPC cannot outpace useful terminal presentation.
const FLUSH_INTERACTIVE_COALESCE: Duration = Duration::from_millis(4);
const FLUSH_SUSTAINED_COALESCE: Duration = Duration::from_millis(16);
const FLUSH_SUSTAINED_WINDOW: Duration = Duration::from_millis(40);
const FLUSH_IMMEDIATE_BYTES: usize = 64 * 1024;
const READ_BUF: usize = 16 * 1024;
const EXIT_ACK_TIMEOUT: Duration = Duration::from_secs(30);
struct OutputQueueState {
    pending: Vec<u8>,
    credit: OutputCredit,
    closed: bool,
    reader_done: bool,
    reader_failed: bool,
    exit_ack_deadline: Option<(Instant, Duration)>,
    drain_timed_out: bool,
}

struct OutputQueue {
    state: Mutex<OutputQueueState>,
    changed: Condvar,
}

impl OutputQueue {
    fn new() -> Self {
        Self {
            state: Mutex::new(OutputQueueState {
                pending: Vec::with_capacity(READ_BUF),
                credit: OutputCredit::default(),
                closed: false,
                reader_done: false,
                reader_failed: false,
                exit_ack_deadline: None,
                drain_timed_out: false,
            }),
            changed: Condvar::new(),
        }
    }

    fn acknowledge(&self, bytes: u64) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        if state.credit.acknowledge(bytes)? {
            if let Some((deadline, timeout)) = &mut state.exit_ack_deadline {
                *deadline = Instant::now() + *timeout;
            }
            self.changed.notify_all();
        }
        Ok(())
    }

    fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        state.pending = Vec::new();
        self.changed.notify_all();
    }

    fn finish_reading(&self) {
        let mut state = self.state.lock().unwrap();
        state.reader_done = true;
        self.changed.notify_all();
    }

    fn begin_exit(&self, timeout: Duration) {
        let mut state = self.state.lock().unwrap();
        state.exit_ack_deadline = Some((Instant::now() + timeout, timeout));
        self.changed.notify_all();
    }

    fn wait_change<'a>(
        &'a self,
        mut state: MutexGuard<'a, OutputQueueState>,
    ) -> MutexGuard<'a, OutputQueueState> {
        if let Some((deadline, _)) = state.exit_ack_deadline {
            if state.credit.in_flight_chunks() > 0 {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    log::error!("PTY output drain timed out after shell exit: {} bytes unacknowledged, {} bytes pending", state.credit.in_flight_bytes(), state.pending.len());
                    state.drain_timed_out = true;
                    state.closed = true;
                    state.pending = Vec::new();
                    self.changed.notify_all();
                    return state;
                }
                return self.changed.wait_timeout(state, remaining).unwrap().0;
            }
        }
        self.changed.wait(state).unwrap()
    }

    fn push(&self, bytes: &[u8]) -> bool {
        let mut state = self.state.lock().unwrap();
        while !state.closed
            && state.pending.len() + state.credit.in_flight_bytes() + bytes.len()
                > MAX_BUFFERED_BYTES
        {
            state = self.wait_change(state);
        }
        if state.closed {
            return false;
        }
        state.pending.extend_from_slice(bytes);
        self.changed.notify_all();
        true
    }

    fn wait_pending(&self) -> Option<usize> {
        let mut state = self.state.lock().unwrap();
        while state.pending.is_empty() && !state.closed {
            if state.reader_done && state.credit.in_flight_chunks() == 0 {
                return None;
            }
            state = self.wait_change(state);
        }
        if state.closed {
            None
        } else {
            Some(state.pending.len())
        }
    }

    fn take(&self) -> Option<Vec<u8>> {
        let mut state = self.state.lock().unwrap();
        while !state.closed && !state.credit.can_send() {
            state = self.wait_change(state);
        }
        if state.closed {
            return None;
        }
        let chunk = std::mem::replace(&mut state.pending, Vec::with_capacity(READ_BUF));
        if !chunk.is_empty() {
            if state.credit.in_flight_chunks() == 0 {
                if let Some((deadline, timeout)) = &mut state.exit_ack_deadline {
                    *deadline = Instant::now() + *timeout;
                }
            }
            state.credit.sent(chunk.len());
        }
        Some(chunk)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OutputDiagnostics {
    shell_pid: u32,
    sent_bytes: u64,
    acknowledged_bytes: u64,
    pending_bytes: usize,
    pending_capacity: usize,
    in_flight_bytes: usize,
    in_flight_chunks: usize,
    reader_done: bool,
    closed: bool,
    drain_timed_out: bool,
    reader_failed: bool,
}

pub struct Session {
    #[cfg(unix)]
    reader_control: Arc<super::unix_reader::ReaderControl>,
    // Drop the Windows job before pipe handles. The waiter retains the master
    // and closes ConPTY while the reader drains the final output through EOF.
    #[cfg(windows)]
    _job: Option<crate::modules::proc::job::ProcessJob>,
    /// PID of the shell process. 0 means unknown; callers must skip checks when 0.
    pub shell_pid: u32,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    output: Arc<OutputQueue>,
    // Set only after output drains, so registration cannot reap a live queue.
    pub(super) finished: Arc<AtomicBool>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.output.close();
        #[cfg(unix)]
        self.reader_control.cancel();
        // If the session Arc is dropped without an explicit pty_close (e.g.
        // frontend disconnected, window crashed, dev HMR), the reader/flusher
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}

impl Session {
    pub(super) fn diagnostics(&self) -> OutputDiagnostics {
        let state = self.output.state.lock().unwrap();
        OutputDiagnostics {
            shell_pid: self.shell_pid,
            sent_bytes: state.credit.sent_bytes(),
            acknowledged_bytes: state.credit.acknowledged_bytes(),
            pending_bytes: state.pending.len(),
            pending_capacity: state.pending.capacity(),
            in_flight_bytes: state.credit.in_flight_bytes(),
            in_flight_chunks: state.credit.in_flight_chunks(),
            reader_done: state.reader_done,
            closed: state.closed,
            drain_timed_out: state.drain_timed_out,
            reader_failed: state.reader_failed,
        }
    }

    pub(super) fn close_output(&self) {
        self.output.close();
        #[cfg(unix)]
        self.reader_control.cancel();
    }

    pub(super) fn resize(&self, size: PtySize) -> Result<(), String> {
        let master = self.master.lock().unwrap();
        master
            .as_ref()
            .ok_or("PTY has exited")?
            .resize(size)
            .map_err(|e| e.to_string())
    }

    pub(super) fn acknowledge_output(&self, bytes: u64) -> Result<(), String> {
        self.output.acknowledge(bytes)
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
        Self {
            killer: Some(killer),
        }
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
    control: Option<crate::modules::control::ShellControlEnv>,
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

    let cmd = shell_init::build_command(cwd, workspace, blocks, shell, control)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    // Kill the child if any of the pipe setup below fails so the spawned shell
    // can't outlive an aborted pty_open.
    let mut guard = ChildKillGuard::new(child.clone_killer());
    let killer = child.clone_killer();
    #[cfg(windows)]
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let (mut reader, reader_control) =
        super::unix_reader::UnixPtyReader::new(pair.master.as_ref()).map_err(|e| e.to_string())?;
    let writer: Arc<Mutex<Box<dyn Write + Send>>> = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    guard.disarm();

    let shell_pid = child.process_id().unwrap_or(0);

    #[cfg(windows)]
    let job = match child.process_id() {
        Some(pid) => match crate::modules::proc::job::ProcessJob::create_for(pid) {
            Ok(j) => Some(j),
            Err(e) => {
                log::warn!("pty job-object setup failed for pid={pid}: {e}");
                None
            }
        },
        None => None,
    };

    let finished = Arc::new(AtomicBool::new(false));
    let output = Arc::new(OutputQueue::new());

    let session = Arc::new(Session {
        #[cfg(unix)]
        reader_control: reader_control.clone(),
        #[cfg(windows)]
        _job: job,
        shell_pid,
        killer: Mutex::new(killer),
        writer: writer.clone(),
        master: Arc::new(Mutex::new(Some(pair.master))),
        output: output.clone(),
        finished: finished.clone(),
    });

    let spawn_at = Instant::now();

    let first_byte = Arc::new(AtomicBool::new(false));

    let output_r = output.clone();
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
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if output_r.state.lock().unwrap().closed {
                            #[cfg(windows)]
                            continue;
                            #[cfg(not(windows))]
                            break;
                        }
                        if !first_byte_r.load(Ordering::Relaxed) {
                            first_byte_r.store(true, Ordering::Release);
                            log::debug!(
                                "pty first byte after {}ms",
                                spawn_at.elapsed().as_millis()
                            );
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
                        if !output_r.push(&filtered) {
                            #[cfg(windows)]
                            continue;
                            #[cfg(not(windows))]
                            break;
                        }
                    }
                    Err(e) => {
                        #[cfg(unix)]
                        {
                            output_r.state.lock().unwrap().reader_failed = true;
                            log::error!("pty reader failed: {e}");
                        }
                        #[cfg(windows)]
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(|t| {
                let _ = app_reader.emit(AGENT_EVENT, t.into_signal(id));
            });
            output_r.finish_reading();
        })
        .expect("spawn pty reader thread");

    let on_data_flush = on_data;
    let output_f = output.clone();
    #[cfg(unix)]
    let reader_control_f = reader_control.clone();
    let flusher_thread = thread::Builder::new()
        .name("terax-pty-flusher".into())
        .spawn(move || {
            let mut last_flush_at: Option<Instant> = None;
            loop {
                let Some(pending_bytes) = output_f.wait_pending() else {
                    return;
                };
                let now = Instant::now();
                let since_last_flush =
                    last_flush_at.map(|last| now.saturating_duration_since(last));
                let delay = flush_coalesce_delay(since_last_flush, pending_bytes);
                if !delay.is_zero() {
                    thread::sleep(delay);
                }
                let Some(chunk) = output_f.take() else {
                    return;
                };
                if chunk.is_empty() {
                    continue;
                }
                if let Err(e) = on_data_flush.send(Response::new(chunk)) {
                    output_f.close();
                    #[cfg(unix)]
                    reader_control_f.cancel();
                    log::debug!("pty flusher exiting, channel closed: {e}");
                    break;
                }
                last_flush_at = Some(Instant::now());
            }
        })
        .expect("spawn pty flusher thread");

    let output_e = output;
    let app_waiter = app;
    let finished_w = finished;
    #[cfg(windows)]
    let master_e = session.master.clone();
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
            // Arm before ConPTY close and either join: both can depend on credit.
            output_e.begin_exit(EXIT_ACK_TIMEOUT);
            #[cfg(unix)]
            reader_control.finish();
            #[cfg(windows)]
            {
                // Closing ConPTY can emit a final frame. Keep the reader alive until EOF.
                let master = master_e.lock().unwrap().take();
                let _guard = CONPTY_LIFECYCLE_LOCK.lock().unwrap();
                drop(master);
            }
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
                output_e.close();
            }
            if let Err(e) = flusher_thread.join() {
                log::error!("pty flusher thread panicked: {e:?}");
            }
            let delivery_failed = {
                let state = output_e.state.lock().unwrap();
                state.drain_timed_out || state.reader_failed
            };
            let code = if delivery_failed { -1 } else { code };
            if let Err(e) = on_exit.send(code) {
                log::debug!("pty exit send failed (channel closed): {e}");
            }
            finished_w.store(true, Ordering::Release);
            if let Some(state) = app_waiter.try_state::<super::PtyState>() {
                if let Some(s) = state.take(id) {
                    drop_session(s);
                }
            }
        })
        .expect("spawn pty waiter thread");

    Ok((session, size))
}

fn flush_coalesce_delay(since_last_flush: Option<Duration>, pending_bytes: usize) -> Duration {
    if pending_bytes >= FLUSH_IMMEDIATE_BYTES {
        return Duration::ZERO;
    }
    if since_last_flush.is_some_and(|elapsed| elapsed <= FLUSH_SUSTAINED_WINDOW) {
        FLUSH_SUSTAINED_COALESCE
    } else {
        FLUSH_INTERACTIVE_COALESCE
    }
}

#[cfg(test)]
mod flow_control_tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn shell_exit_releases_both_workers_when_frontend_stops_acknowledging() {
        let output = Arc::new(OutputQueue::new());
        for _ in 0..2 {
            output.push(&vec![0; MAX_BUFFERED_BYTES / 2]);
            output.take().unwrap();
        }
        let (sent, received) = mpsc::channel();
        let reader_output = output.clone();
        let reader_sent = sent.clone();
        let reader = thread::spawn(move || {
            reader_sent.send(!reader_output.push(&[1])).unwrap();
        });
        let flusher_output = output.clone();
        let flusher = thread::spawn(move || {
            sent.send(flusher_output.take().is_none()).unwrap();
        });
        output.begin_exit(Duration::from_millis(30));
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        flusher.join().unwrap();
        assert!(output.state.lock().unwrap().drain_timed_out);
    }

    #[test]
    fn final_unacknowledged_chunk_times_out_after_reader_eof() {
        let output = OutputQueue::new();
        output.push(&[1]);
        output.take().unwrap();
        output.finish_reading();
        output.begin_exit(Duration::ZERO);
        assert_eq!(output.wait_pending(), None);
        assert!(output.state.lock().unwrap().drain_timed_out);
    }

    #[test]
    fn progressing_exit_drain_preserves_tail_and_renews_deadline() {
        let output = OutputQueue::new();
        output.push(&[1]);
        output.take().unwrap();
        output.begin_exit(Duration::from_secs(1));
        output.state.lock().unwrap().exit_ack_deadline =
            Some((Instant::now(), Duration::from_secs(1)));
        output.acknowledge(1).unwrap();
        assert!(output.state.lock().unwrap().exit_ack_deadline.unwrap().0 > Instant::now());
        output.push(&[2]);
        assert_eq!(output.take().unwrap(), vec![2]);
        output.finish_reading();
        output.acknowledge(2).unwrap();
        assert_eq!(output.wait_pending(), None);
        assert!(!output.state.lock().unwrap().drain_timed_out);
    }

    #[test]
    fn reader_backpressure_releases_only_after_valid_cumulative_credit() {
        let output = Arc::new(OutputQueue::new());
        assert!(output.push(&vec![1; MAX_BUFFERED_BYTES]));
        assert_eq!(output.take().unwrap().len(), MAX_BUFFERED_BYTES);
        let (sent, received) = mpsc::channel();
        let reader_output = output.clone();
        let reader = thread::spawn(move || {
            sent.send(reader_output.push(&[2])).unwrap();
        });
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        assert!(output.acknowledge(1).is_err());
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        output.acknowledge(MAX_BUFFERED_BYTES as u64).unwrap();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        assert_eq!(output.take().unwrap(), vec![2]);
    }

    #[test]
    fn eof_does_not_bypass_chunk_limit_or_final_parser_acknowledgement() {
        let output = Arc::new(OutputQueue::new());
        for byte in [1, 2] {
            assert!(output.push(&[byte]));
            assert_eq!(output.take().unwrap(), vec![byte]);
        }
        assert!(output.push(&[3]));
        output.finish_reading();
        let (sent, received) = mpsc::channel();
        let flusher_output = output.clone();
        let flusher = thread::spawn(move || {
            sent.send(flusher_output.take()).unwrap();
            sent.send(flusher_output.wait_pending().map(|_| Vec::new()))
                .unwrap();
        });
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        output.acknowledge(2).unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(1)).unwrap(),
            Some(vec![3])
        );
        output.acknowledge(2).unwrap();
        assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
        output.acknowledge(3).unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(1)).unwrap(), None);
        flusher.join().unwrap();
    }

    #[test]
    fn close_releases_a_reader_and_flusher_waiting_on_lost_credit() {
        let output = Arc::new(OutputQueue::new());
        for _ in 0..2 {
            assert!(output.push(&vec![0; MAX_BUFFERED_BYTES / 2]));
            output.take().unwrap();
        }
        let (sent, received) = mpsc::channel();
        let reader_output = output.clone();
        let reader_sent = sent.clone();
        let reader = thread::spawn(move || {
            reader_sent.send(!reader_output.push(&[1])).unwrap();
        });
        let flusher_output = output.clone();
        let flusher = thread::spawn(move || {
            sent.send(flusher_output.take().is_none()).unwrap();
        });
        output.close();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
        reader.join().unwrap();
        flusher.join().unwrap();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use portable_pty::CommandBuilder;

    #[test]
    fn pty_output_coalescing_preserves_latency_and_bounds_sustained_ipc() {
        assert_eq!(flush_coalesce_delay(None, 1), FLUSH_INTERACTIVE_COALESCE);
        assert_eq!(
            flush_coalesce_delay(Some(Duration::from_millis(100)), 1),
            FLUSH_INTERACTIVE_COALESCE,
        );
        assert_eq!(
            flush_coalesce_delay(Some(Duration::from_millis(10)), 1),
            FLUSH_SUSTAINED_COALESCE,
        );
        assert_eq!(
            flush_coalesce_delay(Some(Duration::from_millis(10)), FLUSH_IMMEDIATE_BYTES),
            Duration::ZERO,
        );
    }

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
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            reader_control: super::super::unix_reader::UnixPtyReader::new(pair.master.as_ref())
                .unwrap()
                .1,
            shell_pid: child.process_id().unwrap_or(0),
            killer: Mutex::new(killer),
            writer,
            master: Arc::new(Mutex::new(Some(pair.master))),
            output: Arc::new(OutputQueue::new()),
            finished: Arc::new(AtomicBool::new(false)),
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
        let writer: Arc<Mutex<Box<dyn Write + Send>>> =
            Arc::new(Mutex::new(pair.master.take_writer().expect("writer")));

        let session = Arc::new(Session {
            reader_control: super::super::unix_reader::UnixPtyReader::new(pair.master.as_ref())
                .unwrap()
                .1,
            shell_pid: 0,
            killer: Mutex::new(killer),
            writer,
            master: Arc::new(Mutex::new(Some(pair.master))),
            output: Arc::new(OutputQueue::new()),
            finished: Arc::new(AtomicBool::new(false)),
        });

        drop_session(session);
    }
}
