//! Bounded one-shot process runner shared by the shell tool and git.
//!
//! Costs two short-lived reader threads per call (the old runners used four)
//! and never waits on a pipe that a surviving grandchild keeps open: output is
//! collected with a grace deadline once the child is gone.

use std::io::{self, Read};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use shared_child::SharedChild;

const READER_STACK: usize = 128 * 1024;
const READ_CHUNK: usize = 16 * 1024;
/// How long output may keep arriving after a child exited normally. A
/// backgrounded grandchild (`cmd &`) inherits the pipes and would otherwise
/// pin the caller until it exits.
const EXITED_DRAIN_GRACE: Duration = Duration::from_millis(750);
const KILLED_DRAIN_GRACE: Duration = Duration::from_millis(500);

#[derive(Clone, Copy)]
pub struct Limits {
    pub stdout: usize,
    pub stderr: usize,
    /// Kill the child as soon as stdout passes its cap instead of letting it
    /// run on for output nobody will read.
    pub stop_on_stdout_cap: bool,
}

#[derive(Debug, Default)]
pub struct Captured {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

#[derive(Default)]
struct Drained {
    bytes: Vec<u8>,
    truncated: bool,
}

struct Reader {
    shared: Arc<Mutex<Drained>>,
    done: mpsc::Receiver<()>,
}

/// Keeps reading past the cap so the child never blocks on a full pipe, unless
/// `on_cap` is given, which is called once when the cap is first exceeded.
fn drain<R: Read>(mut reader: R, cap: usize, shared: &Mutex<Drained>, on_cap: Option<&dyn Fn()>) {
    let mut buf = [0u8; READ_CHUNK];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let mut out = shared.lock().unwrap_or_else(|e| e.into_inner());
                let take = cap.saturating_sub(out.bytes.len()).min(n);
                out.bytes.extend_from_slice(&buf[..take]);
                if take < n {
                    let first = !out.truncated;
                    out.truncated = true;
                    drop(out);
                    if let (true, Some(stop)) = (first, on_cap) {
                        stop();
                    }
                }
            }
        }
    }
}

fn spawn_reader<R: Read + Send + 'static>(
    name: &'static str,
    reader: R,
    cap: usize,
    on_cap: Option<Arc<SharedChild>>,
) -> io::Result<Reader> {
    let shared = Arc::new(Mutex::new(Drained::default()));
    let (tx, done) = mpsc::channel();
    let writer = shared.clone();
    thread::Builder::new()
        .name(name.into())
        .stack_size(READER_STACK)
        .spawn(move || {
            let stop = on_cap.map(|child| {
                move || {
                    let _ = child.kill();
                }
            });
            drain(reader, cap, &writer, stop.as_ref().map(|f| f as &dyn Fn()));
            let _ = tx.send(());
        })?;
    Ok(Reader { shared, done })
}

/// Waits for EOF up to `grace`, then returns whatever has arrived. The reader
/// stays bounded by `cap` and exits on its own when the pipe finally closes.
fn collect(reader: &Reader, grace: Duration) -> Drained {
    let _ = reader.done.recv_timeout(grace);
    std::mem::take(&mut *reader.shared.lock().unwrap_or_else(|e| e.into_inner()))
}

/// `cmd` must already pipe stdout and stderr. Blocks the calling thread, so run
/// it on the blocking pool.
pub fn run(cmd: &mut Command, timeout: Duration, limits: Limits) -> io::Result<Captured> {
    let child = Arc::new(SharedChild::spawn(cmd)?);
    let fail = |error: io::Error| {
        let _ = child.kill();
        let _ = child.wait();
        error
    };
    let stdout = child
        .take_stdout()
        .ok_or_else(|| fail(io::Error::other("no stdout pipe")))?;
    let stderr = child
        .take_stderr()
        .ok_or_else(|| fail(io::Error::other("no stderr pipe")))?;
    let stdout_reader = spawn_reader(
        "terax-cap-out",
        stdout,
        limits.stdout,
        limits.stop_on_stdout_cap.then(|| child.clone()),
    )
    .map_err(fail)?;
    let stderr_reader = spawn_reader("terax-cap-err", stderr, limits.stderr, None).map_err(fail)?;

    let (exit_code, timed_out) = match child.wait_timeout(timeout)? {
        Some(status) => (status.code(), false),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            (None, true)
        }
    };

    let grace = if timed_out {
        KILLED_DRAIN_GRACE
    } else {
        EXITED_DRAIN_GRACE
    };
    let out = collect(&stdout_reader, grace);
    let err = collect(&stderr_reader, grace);
    Ok(Captured {
        stdout: out.bytes,
        stderr: err.bytes,
        stdout_truncated: out.truncated,
        stderr_truncated: err.truncated,
        exit_code,
        timed_out,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Instant;

    fn sh(script: &str) -> Command {
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    const LIMITS: Limits = Limits {
        stdout: 1024,
        stderr: 1024,
        stop_on_stdout_cap: false,
    };

    #[test]
    fn captures_both_streams_and_the_exit_code() {
        let out = run(
            &mut sh("printf out; printf err >&2; exit 3"),
            Duration::from_secs(5),
            LIMITS,
        )
        .unwrap();
        assert_eq!(out.stdout, b"out");
        assert_eq!(out.stderr, b"err");
        assert_eq!(out.exit_code, Some(3));
        assert!(!out.timed_out);
    }

    #[test]
    fn caps_each_stream_and_reports_truncation_without_stalling_the_child() {
        let out = run(
            &mut sh("head -c 200000 /dev/zero; head -c 5000 /dev/zero >&2"),
            Duration::from_secs(10),
            LIMITS,
        )
        .unwrap();
        assert_eq!(out.stdout.len(), 1024);
        assert!(out.stdout_truncated);
        assert_eq!(out.stderr.len(), 1024);
        assert!(out.stderr_truncated);
        assert_eq!(out.exit_code, Some(0));
    }

    #[test]
    fn a_child_can_be_stopped_the_moment_it_exceeds_the_stdout_cap() {
        let started = Instant::now();
        let out = run(
            &mut sh("yes | head -c 100000000"),
            Duration::from_secs(30),
            Limits {
                stdout: 4096,
                stderr: 1024,
                stop_on_stdout_cap: true,
            },
        )
        .unwrap();
        assert!(out.stdout_truncated);
        assert_eq!(out.stdout.len(), 4096);
        assert!(!out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn kills_a_child_that_outlives_the_timeout() {
        let started = Instant::now();
        let out = run(&mut sh("sleep 30"), Duration::from_millis(200), LIMITS).unwrap();
        assert!(out.timed_out);
        assert_eq!(out.exit_code, None);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_backgrounded_grandchild_holding_the_pipes_does_not_pin_the_caller() {
        let started = Instant::now();
        let out = run(
            &mut sh("printf done; sleep 30 &"),
            Duration::from_secs(10),
            LIMITS,
        )
        .unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out);
        assert_eq!(out.stdout, b"done", "output written before exit is kept");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "returned after {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn spawn_failure_is_an_error() {
        let mut cmd = Command::new("/definitely/not/a/binary");
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        assert!(run(&mut cmd, Duration::from_secs(1), LIMITS).is_err());
    }
}
