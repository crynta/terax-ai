use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use super::agent_detect::{AgentDetector, AgentSignal};
use super::da_filter::DaFilter;
use super::hub::{Command, Hub};
use super::presentation::PresentationClass;
use super::queue::{OutputQueue, QueueDiagnostics};
use super::shell_init;
use crate::modules::workspace::WorkspaceEnv;

const AGENT_EVENT: &str = "terax:agent-signal";

const READ_BUF: usize = 16 * 1024;
const EXIT_ACK_TIMEOUT: Duration = Duration::from_secs(30);
/// Writes queued ahead of the writer thread; a full queue applies async
/// backpressure to `pty_write` instead of growing without bound.
const INPUT_QUEUE: usize = 64;
// Three small threads per PTY: keep their stacks small. The reader calls
// Tauri's event emit, so it keeps a little more than the others.
const READER_STACK: usize = 256 * 1024;
const WRITER_STACK: usize = 128 * 1024;
const WAITER_STACK: usize = 256 * 1024;

struct InputMessage {
    bytes: Vec<u8>,
    /// Receives the write result; absent for fire-and-forget terminal replies.
    done: Option<oneshot::Sender<Result<(), String>>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OutputDiagnostics {
    shell_pid: u32,
    #[serde(flatten)]
    queue: QueueDiagnostics,
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
    /// Label of the webview that opened this PTY and receives its output.
    pub owner: Arc<str>,
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// Feeds the per-session writer thread, which keeps input ordered and off
    /// every async worker.
    input: mpsc::Sender<InputMessage>,
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
        // frontend disconnected, window crashed, dev HMR), the reader/waiter
        // threads would otherwise stay alive forever holding the child. Kill
        // the child here so the reader hits EOF and the threads unwind.
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
    }
}

impl Session {
    pub(super) fn diagnostics(&self) -> OutputDiagnostics {
        OutputDiagnostics {
            shell_pid: self.shell_pid,
            queue: self.output.diagnostics(),
        }
    }

    #[cfg(all(test, unix))]
    pub(super) fn queue_closed(&self) -> bool {
        self.output.is_closed()
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

    /// Queues `bytes` for the writer thread and resolves with the result of
    /// the actual pipe write, so callers still see real I/O errors in order.
    pub(super) async fn write(&self, bytes: Vec<u8>) -> Result<(), String> {
        let (done, result) = oneshot::channel();
        self.input
            .send(InputMessage {
                bytes,
                done: Some(done),
            })
            .await
            .map_err(|_| "PTY input is closed".to_string())?;
        result
            .await
            .map_err(|_| "PTY input is closed".to_string())?
    }
}

// Serializes ConPTY create and close: overlapping pseudoconsole lifecycle
// calls corrupt the new console so its shell never pumps output (issue #356).
// Holders must not wait on anything that depends on the frontend: every
// terminal opened or closed meanwhile waits behind them.
#[cfg(windows)]
static CONPTY_LIFECYCLE_LOCK: Mutex<()> = Mutex::new(());

/// A panic inside a lifecycle call must not make every later terminal panic.
#[cfg(any(windows, test))]
fn lock_lifecycle(lock: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    lock.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(super) fn drop_session(session: Arc<Session>) {
    #[cfg(windows)]
    let _guard = lock_lifecycle(&CONPTY_LIFECYCLE_LOCK);
    drop(session);
}

/// What conhost can still hold when its console is closed is a final frame or
/// two; a megabyte of headroom is far more than that.
#[cfg(any(windows, test))]
const CLOSE_OVERDRAFT: usize = 1024 * 1024;

/// Runs `close`, the drop of the ConPTY handle, under the lifecycle lock.
///
/// Closing a pseudoconsole blocks until conhost has written everything it
/// holds into the output pipe and the reader has taken it. A reader that is
/// waiting for credit (the frontend has not caught up on a backlog) would keep
/// `close`, and with it the lock that every `pty_open` needs, waiting for the
/// frontend for as long as the 30 second drain deadline. So the reader is made
/// unable to block on credit first, outside the lock; the lock then covers
/// only the close, which was its purpose.
#[cfg(any(windows, test))]
fn close_pseudoconsole(output: &OutputQueue, lifecycle: &Mutex<()>, close: impl FnOnce()) {
    output.allow_overdraft(CLOSE_OVERDRAFT);
    let _guard = lock_lifecycle(lifecycle);
    close();
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

/// Everything a PTY needs from the host that is not the shell itself.
pub(super) struct Host {
    pub id: u32,
    pub owner: Arc<str>,
    pub hub: Hub,
    pub class: PresentationClass,
    /// Agent detector transitions (an app event in production).
    pub signal: Arc<dyn Fn(AgentSignal) + Send + Sync>,
    /// Runs on the waiter thread once the exit frame was delivered.
    pub reap: Box<dyn FnOnce() + Send>,
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    id: u32,
    app: AppHandle,
    owner: Arc<str>,
    hub: Hub,
    class: PresentationClass,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    workspace: WorkspaceEnv,
    blocks: bool,
    shell: Option<String>,
    control: Option<crate::modules::control::ShellControlEnv>,
) -> Result<Arc<Session>, String> {
    let emitter = app.clone();
    spawn_with(
        Host {
            id,
            owner,
            hub,
            class,
            signal: Arc::new(move |signal| {
                let _ = emitter.emit(AGENT_EVENT, signal);
            }),
            reap: Box::new(move || {
                if let Some(state) = app.try_state::<super::PtyState>() {
                    if let Some(s) = state.take(id) {
                        drop_session(s);
                    }
                }
            }),
        },
        PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        },
        move || shell_init::build_command(cwd, workspace, blocks, shell, control),
    )
}

pub(super) fn spawn_with(
    host: Host,
    size: PtySize,
    build_command: impl FnOnce() -> Result<CommandBuilder, String>,
) -> Result<Arc<Session>, String> {
    #[cfg(windows)]
    let _spawn_guard = lock_lifecycle(&CONPTY_LIFECYCLE_LOCK);

    let Host {
        id,
        owner,
        hub,
        class,
        signal,
        reap,
    } = host;
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let cmd = build_command()?;
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
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
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
    let output = Arc::new(OutputQueue::new(Some(hub.wake())));
    let (input, mut input_rx) = mpsc::channel::<InputMessage>(INPUT_QUEUE);

    hub.submit(Command::Register {
        id,
        label: owner.clone(),
        queue: output.clone(),
        class,
    });
    // Until the threads below exist, a failure must not leave the hub holding
    // a queue nobody will ever drain.
    let registration = Registration {
        hub: hub.clone(),
        id,
        armed: true,
    };

    let session = Arc::new(Session {
        #[cfg(unix)]
        reader_control: reader_control.clone(),
        #[cfg(windows)]
        _job: job,
        shell_pid,
        owner,
        killer: Mutex::new(killer),
        input: input.clone(),
        master: Arc::new(Mutex::new(Some(pair.master))),
        output: output.clone(),
        finished: finished.clone(),
    });

    // The writer thread owns the PTY input: one ordered queue for keystrokes,
    // pastes and terminal replies, with no per-write task or lock.
    let spawn_error =
        |what: &str, e: std::io::Error| format!("could not start PTY {what} thread: {e}");
    thread::Builder::new()
        .name("terax-pty-writer".into())
        .stack_size(WRITER_STACK)
        .spawn(move || {
            while let Some(message) = input_rx.blocking_recv() {
                let result = writer.write_all(&message.bytes).map_err(|e| {
                    log::debug!("pty write failed: {e}");
                    e.to_string()
                });
                if let Some(done) = message.done {
                    let _ = done.send(result);
                }
            }
        })
        .map_err(|e| spawn_error("writer", e))?;

    let spawn_at = Instant::now();
    let output_r = output.clone();
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .stack_size(READER_STACK)
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            // Reused for every filtered read: no per-chunk allocation.
            let mut filtered: Vec<u8> = Vec::with_capacity(READ_BUF);
            let mut da_filter = DaFilter::new();
            let mut agent_detect = AgentDetector::new();
            let mut first_byte = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if output_r.is_closed() {
                            #[cfg(windows)]
                            continue;
                            #[cfg(not(windows))]
                            break;
                        }
                        if !first_byte {
                            first_byte = true;
                            log::debug!(
                                "pty first byte after {}ms",
                                spawn_at.elapsed().as_millis()
                            );
                        }
                        let read = &buf[..n];
                        agent_detect.process(read, |t| signal(t.into_signal(id)));
                        let chunk: &[u8] = if da_filter.passes_through(read) {
                            read
                        } else {
                            filtered.clear();
                            da_filter.process(read, &mut filtered, |reply| {
                                // Replies share the ordered input queue; a full
                                // queue drops one rather than stalling output.
                                if input
                                    .try_send(InputMessage {
                                        bytes: reply.to_vec(),
                                        done: None,
                                    })
                                    .is_err()
                                {
                                    log::debug!("pty terminal reply dropped: input queue is full");
                                }
                            });
                            &filtered
                        };
                        if chunk.is_empty() {
                            continue;
                        }
                        if !output_r.push(chunk) {
                            #[cfg(windows)]
                            continue;
                            #[cfg(not(windows))]
                            break;
                        }
                    }
                    Err(e) => {
                        #[cfg(unix)]
                        {
                            output_r.fail_reading();
                            log::error!("pty reader failed: {e}");
                        }
                        #[cfg(windows)]
                        log::debug!("pty reader ended: {e}");
                        break;
                    }
                }
            }
            agent_detect.finish(|t| signal(t.into_signal(id)));
            output_r.finish_reading();
        })
        .map_err(|e| spawn_error("reader", e))?;

    let output_e = output;
    let finished_w = finished;
    #[cfg(windows)]
    let master_e = session.master.clone();
    thread::Builder::new()
        .name("terax-pty-waiter".into())
        .stack_size(WAITER_STACK)
        .spawn(move || {
            let code = match child.wait() {
                Ok(status) => status.exit_code() as i32,
                Err(e) => {
                    log::warn!("pty child wait failed: {e}");
                    -1
                }
            };
            // Arm before ConPTY close and the join: both can depend on credit.
            output_e.begin_exit(EXIT_ACK_TIMEOUT);
            #[cfg(unix)]
            reader_control.finish();
            #[cfg(windows)]
            {
                // Closing ConPTY can emit a final frame. Keep the reader alive until EOF.
                let master = master_e.lock().unwrap().take();
                close_pseudoconsole(&output_e, &CONPTY_LIFECYCLE_LOCK, move || drop(master));
            }
            if let Err(e) = reader_thread.join() {
                log::error!("pty reader thread panicked: {e:?}");
                output_e.fail_reading();
                output_e.finish_reading();
            }
            // The hub sends the exit frame once the reader drained and every
            // data frame was acknowledged (or the drain deadline passed).
            output_e.set_exit_code(code);
            output_e.wait_finished();
            finished_w.store(true, Ordering::Release);
            reap();
        })
        .map_err(|e| spawn_error("waiter", e))?;

    registration.disarm();
    Ok(session)
}

/// Unregisters a PTY from the hub unless the spawn completed.
struct Registration {
    hub: Hub,
    id: u32,
    armed: bool,
}

impl Registration {
    fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if self.armed {
            self.hub.submit(Command::Unregister { id: self.id });
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::modules::pty::hub::{Endpoint, Reply};
    use crate::modules::pty::wire::{decode_frames, Ack, Frame, StreamRequest};
    use std::sync::mpsc as std_mpsc;

    struct ChannelReply(std_mpsc::Sender<(u16, Vec<u8>)>);

    impl Reply for ChannelReply {
        fn send(self: Box<Self>, status: u16, body: Vec<u8>) {
            let _ = self.0.send((status, body));
        }
    }

    /// A stand-in for the frontend: opens a stream, polls, acknowledges what
    /// it received after every response, and records what arrived.
    struct Frontend {
        hub: Hub,
        label: Arc<str>,
        token: u64,
        received: Vec<u8>,
        acked: u64,
        exit: Option<i32>,
        max_in_flight: u64,
        frames_after_exit: usize,
    }

    impl Frontend {
        fn open(hub: &Hub, label: &str) -> Self {
            let (tx, rx) = std_mpsc::channel();
            let label: Arc<str> = Arc::from(label);
            hub.submit(Command::OpenStream {
                label: label.clone(),
                reply: Box::new(move |token| tx.send(token).unwrap()),
            });
            Self {
                hub: hub.clone(),
                label,
                token: rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap(),
                received: Vec::new(),
                acked: 0,
                exit: None,
                max_in_flight: 0,
                frames_after_exit: 0,
            }
        }

        fn poll_once(&mut self, id: u32, acks: Vec<Ack>) -> Vec<Vec<u8>> {
            let (tx, rx) = std_mpsc::channel();
            self.hub.submit(Command::Request {
                label: self.label.clone(),
                endpoint: Endpoint::Poll,
                request: StreamRequest {
                    token: self.token,
                    acks,
                },
                reply: Box::new(ChannelReply(tx)),
            });
            let (status, body) = rx
                .recv_timeout(Duration::from_secs(10))
                .expect("a response within 10 s");
            assert_eq!(status, 200);
            let mut payloads = Vec::new();
            for frame in decode_frames(&body).unwrap() {
                match frame {
                    Frame::Data {
                        id: i,
                        offset,
                        payload,
                    } if i == id => {
                        assert_eq!(self.exit, None, "no data after the exit frame");
                        assert_eq!(offset, self.received.len() as u64, "gapless stream");
                        self.received.extend_from_slice(payload);
                        payloads.push(payload.to_vec());
                    }
                    Frame::Exit { id: i, code } if i == id => self.exit = Some(code),
                    Frame::Sync { .. } => {}
                    other => panic!("unexpected frame {other:?}"),
                }
                if self.exit.is_some() {
                    self.frames_after_exit += 1;
                }
            }
            payloads
        }

        /// Polls (acknowledging everything received so far) until exit.
        fn run_until_exit(&mut self, id: u32, session: &Session) {
            let mut acks = vec![Ack { id, bytes: 0 }];
            while self.exit.is_none() {
                self.poll_once(id, std::mem::take(&mut acks));
                let in_flight = session.output.diagnostics().in_flight_bytes as u64;
                self.max_in_flight = self.max_in_flight.max(in_flight);
                let end = self.received.len() as u64;
                if end > self.acked {
                    self.acked = end;
                    acks.push(Ack { id, bytes: end });
                }
            }
        }
    }

    fn host(id: u32, hub: &Hub) -> (Host, std_mpsc::Receiver<()>) {
        let (reaped, reaped_rx) = std_mpsc::channel();
        (
            Host {
                id,
                owner: Arc::from("main"),
                hub: hub.clone(),
                class: PresentationClass::Focused,
                signal: Arc::new(|_| {}),
                reap: Box::new(move || {
                    let _ = reaped.send(());
                }),
            },
            reaped_rx,
        )
    }

    fn sh(script: &str) -> CommandBuilder {
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg(script);
        command
    }

    fn start(script: &str) -> (Hub, Arc<Session>, Frontend, std_mpsc::Receiver<()>) {
        let hub = Hub::new();
        let frontend = Frontend::open(&hub, "main");
        let (host, reaped) = host(1, &hub);
        let session = spawn_with(host, PtySize::default(), || Ok(sh(script))).unwrap();
        (hub, session, frontend, reaped)
    }

    #[test]
    fn output_arrives_in_order_and_the_exit_frame_follows_every_data_frame() {
        let (_hub, session, mut frontend, reaped) =
            start("printf hello; sleep 0.05; printf ' world'; exit 7");
        frontend.run_until_exit(1, &session);
        assert_eq!(frontend.exit, Some(7));
        assert_eq!(String::from_utf8_lossy(&frontend.received), "hello world");
        assert_eq!(
            frontend.frames_after_exit, 1,
            "nothing follows the exit frame"
        );
        reaped.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(session.finished.load(Ordering::Acquire));
    }

    #[test]
    fn a_four_mebibyte_flood_is_flow_controlled_and_complete() {
        let (_hub, session, mut frontend, reaped) =
            start("dd if=/dev/zero bs=65536 count=64 2>/dev/null");
        frontend.run_until_exit(1, &session);
        assert_eq!(frontend.exit, Some(0));
        assert_eq!(frontend.received.len(), 4 * 1024 * 1024);
        assert!(frontend.received.iter().all(|byte| *byte == 0));
        assert!(
            frontend.max_in_flight <= super::super::output::MAX_IN_FLIGHT_BYTES as u64,
            "in flight {}",
            frontend.max_in_flight
        );
        reaped.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn output_before_the_receiver_attaches_is_held_not_dropped() {
        let (_hub, session, mut frontend, reaped) = start("printf early; exit 0");
        // The shell is long gone before the frontend announces itself.
        thread::sleep(Duration::from_millis(300));
        assert!(frontend.received.is_empty());
        assert!(!session.finished.load(Ordering::Acquire));
        frontend.run_until_exit(1, &session);
        assert_eq!(String::from_utf8_lossy(&frontend.received), "early");
        assert_eq!(frontend.exit, Some(0));
        reaped.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn a_stalled_parser_cannot_pin_a_flood_forever_when_the_session_is_closed() {
        let (_hub, session, mut frontend, reaped) = start("yes");
        // Attach and read one response, then stop acknowledging entirely.
        frontend.poll_once(1, vec![Ack { id: 1, bytes: 0 }]);
        thread::sleep(Duration::from_millis(200));
        let diagnostics = session.output.diagnostics();
        assert!(diagnostics.in_flight_bytes > 0);
        assert!(
            diagnostics.in_flight_bytes + diagnostics.pending_bytes
                <= super::super::output::MAX_BUFFERED_BYTES,
            "backpressure bounds the queue: {} + {}",
            diagnostics.in_flight_bytes,
            diagnostics.pending_bytes
        );
        // What `pty_close` does: close output, kill, then drop the session.
        // Dropping the master hangs up the terminal, which also frees a child
        // blocked on a full output buffer that SIGHUP alone cannot reach.
        session.close_output();
        let _ = session.killer.lock().unwrap().kill();
        drop(session);
        reaped.recv_timeout(Duration::from_secs(10)).unwrap();
    }

    #[test]
    fn writes_are_ordered_through_the_single_writer_thread() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let (_hub, session, mut frontend, reaped) = start("stty raw -echo; printf ready; cat");
        let mut acks = vec![Ack { id: 1, bytes: 0 }];
        let poll = |frontend: &mut Frontend, acks: &mut Vec<Ack>| {
            frontend.poll_once(1, std::mem::take(acks));
            acks.push(Ack {
                id: 1,
                bytes: frontend.received.len() as u64,
            });
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        while frontend.received != b"ready" && Instant::now() < deadline {
            poll(&mut frontend, &mut acks);
        }
        // Concurrent callers each wait for their own completion; the writer
        // thread applies them in submission order.
        runtime.block_on(async {
            for chunk in [&b"one "[..], b"two ", b"three"] {
                session.write(chunk.to_vec()).await.unwrap();
            }
        });
        while frontend.received.len() < "readyone two three".len() && Instant::now() < deadline {
            poll(&mut frontend, &mut acks);
        }
        assert_eq!(
            String::from_utf8_lossy(&frontend.received),
            "readyone two three"
        );
        session.close_output();
        let _ = session.killer.lock().unwrap().kill();
        reaped.recv_timeout(Duration::from_secs(10)).unwrap();
    }

    #[test]
    fn terminal_replies_use_the_ordered_input_queue() {
        let (_hub, session, mut frontend, reaped) = start(
            "stty raw -echo; printf '\\033[c'; dd bs=1 count=7 2>/dev/null | od -An -c; exit 0",
        );
        frontend.run_until_exit(1, &session);
        let text = String::from_utf8_lossy(&frontend.received).to_string();
        // The DA1 query is answered, not displayed; the reply reached stdin.
        assert!(!text.contains('\u{1b}'), "{text:?}");
        assert!(text.contains('?') && text.contains('c'), "{text:?}");
        reaped.recv_timeout(Duration::from_secs(5)).unwrap();
    }

    #[test]
    fn dropping_the_session_kills_the_child() {
        let hub = Hub::new();
        let (host, _reaped) = host(2, &hub);
        let session = spawn_with(host, PtySize::default(), || Ok(sh("sleep 30"))).unwrap();
        let pid = session.shell_pid as i32;
        assert!(pid > 0);
        assert_eq!(unsafe { libc::kill(pid, 0) }, 0, "child alive before drop");
        drop(session);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut exited = false;
        while Instant::now() < deadline {
            let mut status = 0;
            let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            // The waiter thread may have reaped it first (ECHILD) or we did.
            if waited == pid || (waited == -1 && unsafe { libc::kill(pid, 0) } != 0) {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(exited, "child still running 5 s after Session drop");
    }

    #[test]
    fn a_shell_that_exits_instantly_is_reaped_after_delivery() {
        let (_hub, session, mut frontend, reaped) = start("exit 0");
        thread::sleep(Duration::from_millis(100));
        assert!(
            !session.finished.load(Ordering::Acquire),
            "exit is held for the frontend"
        );
        frontend.run_until_exit(1, &session);
        assert_eq!(frontend.exit, Some(0));
        reaped.recv_timeout(Duration::from_secs(5)).unwrap();
        drop_session(session);
    }

    /// A reader parked in `push` because the frontend has not caught up.
    fn blocked_reader(
        output: &Arc<OutputQueue>,
    ) -> (thread::JoinHandle<()>, std_mpsc::Receiver<bool>) {
        use crate::modules::pty::output::MAX_IN_FLIGHT_BYTES;
        assert!(output.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        let mut sent = Vec::new();
        output
            .take_into(&mut sent, usize::MAX, Instant::now())
            .unwrap();
        assert!(output.push(&vec![0; MAX_IN_FLIGHT_BYTES]));
        let (done, pushed) = std_mpsc::channel();
        let output = output.clone();
        let reader = thread::spawn(move || {
            done.send(output.push(&[1; 4096])).unwrap();
        });
        assert!(
            pushed.recv_timeout(Duration::from_millis(100)).is_err(),
            "the reader must be waiting for credit"
        );
        (reader, pushed)
    }

    #[test]
    fn closing_the_console_does_not_wait_for_the_frontend_while_holding_the_lifecycle_lock() {
        let output = Arc::new(OutputQueue::new(None));
        let (reader, pushed) = blocked_reader(&output);
        let lifecycle = Arc::new(Mutex::new(()));
        // Stands in for ClosePseudoConsole: it returns only once the reader has
        // taken what conhost still holds. No acknowledgement ever arrives.
        let (closed, closed_rx) = std_mpsc::channel();
        let closer = {
            let (output, lifecycle) = (output.clone(), lifecycle.clone());
            thread::spawn(move || {
                close_pseudoconsole(&output, &lifecycle, || {
                    let drained = pushed.recv_timeout(Duration::from_secs(5)).is_ok();
                    closed.send(drained).unwrap();
                });
            })
        };
        assert_eq!(
            closed_rx.recv_timeout(Duration::from_secs(10)),
            Ok(true),
            "the close waited on a reader that was blocked on credit"
        );
        closer.join().unwrap();
        reader.join().unwrap();
        // The lock is free again right away for the next terminal.
        let started = Instant::now();
        drop(lock_lifecycle(&lifecycle));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn the_reader_is_released_before_the_lifecycle_lock_is_taken() {
        let output = Arc::new(OutputQueue::new(None));
        let (reader, pushed) = blocked_reader(&output);
        let lifecycle = Arc::new(Mutex::new(()));
        // Another terminal is mid-spawn and holds the lock.
        let spawning = lock_lifecycle(&lifecycle);
        let closer = {
            let (output, lifecycle) = (output.clone(), lifecycle.clone());
            thread::spawn(move || close_pseudoconsole(&output, &lifecycle, || {}))
        };
        assert_eq!(
            pushed.recv_timeout(Duration::from_secs(5)),
            Ok(true),
            "the reader stays blocked while the closer queues for the lock"
        );
        assert!(!closer.is_finished(), "the close still waits its turn");
        drop(spawning);
        closer.join().unwrap();
        reader.join().unwrap();
    }

    #[test]
    fn the_close_runs_exactly_once_and_under_the_lock() {
        let output = OutputQueue::new(None);
        let lifecycle = Mutex::new(());
        let mut ran = 0;
        close_pseudoconsole(&output, &lifecycle, || {
            ran += 1;
            assert!(lifecycle.try_lock().is_err(), "the close holds the lock");
        });
        assert_eq!(ran, 1);
        assert!(lifecycle.try_lock().is_ok(), "released afterwards");
    }

    #[test]
    fn a_panic_during_a_close_does_not_poison_later_terminals() {
        let output = OutputQueue::new(None);
        let lifecycle = Mutex::new(());
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            close_pseudoconsole(&output, &lifecycle, || panic!("conhost vanished"));
        }));
        assert!(panicked.is_err());
        assert!(lifecycle.is_poisoned());
        let mut ran = false;
        close_pseudoconsole(&output, &lifecycle, || ran = true);
        assert!(ran);
        drop(lock_lifecycle(&lifecycle));
    }
}
