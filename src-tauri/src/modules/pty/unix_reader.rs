//! Interruptible reads without idle polling. Duplicated master descriptors share
//! file status flags with the input writer, so this leaves O_NONBLOCK unchanged.
//! After shell exit, drain ready output but do not wait for inherited slave EOF.

use std::fs::File;
use std::io::{self, Read};
use std::net::Shutdown;
use std::os::fd::{AsRawFd, BorrowedFd};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use portable_pty::MasterPty;

const RUNNING: u8 = 0;
const DRAINING: u8 = 1;
const CANCELLED: u8 = 2;
const MAX_EXIT_DRAIN_BYTES: usize = 2 * 1024 * 1024;
const MAX_EXIT_DRAIN_TIME: Duration = Duration::from_secs(30);

pub(super) struct ReaderControl {
    state: AtomicU8,
    wake: UnixStream,
}

impl ReaderControl {
    pub(super) fn finish(&self) {
        self.state.fetch_max(DRAINING, Ordering::Release);
        let _ = self.wake.shutdown(Shutdown::Write);
    }

    pub(super) fn cancel(&self) {
        self.state.store(CANCELLED, Ordering::Release);
        let _ = self.wake.shutdown(Shutdown::Write);
    }
}

pub(super) struct UnixPtyReader {
    file: File,
    wake: UnixStream,
    control: Arc<ReaderControl>,
    drain_started: Option<Instant>,
    drain_bytes: usize,
}

impl UnixPtyReader {
    pub(super) fn new(master: &dyn MasterPty) -> io::Result<(Self, Arc<ReaderControl>)> {
        let fd = master
            .as_raw_fd()
            .ok_or_else(|| io::Error::other("Unix PTY has no pollable descriptor"))?;
        // The master owns this descriptor for the duration of the duplication.
        let file = File::from(unsafe { BorrowedFd::borrow_raw(fd) }.try_clone_to_owned()?);
        let (wake_read, wake_write) = UnixStream::pair()?;
        let control = Arc::new(ReaderControl {
            state: AtomicU8::new(RUNNING),
            wake: wake_write,
        });
        Ok((
            Self {
                file,
                wake: wake_read,
                control: control.clone(),
                drain_started: None,
                drain_bytes: 0,
            },
            control,
        ))
    }
}

impl Read for UnixPtyReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        loop {
            let state = self.control.state.load(Ordering::Acquire);
            if state == CANCELLED {
                return Ok(0);
            }
            let draining = state == DRAINING;
            if draining {
                let started = self.drain_started.get_or_insert_with(Instant::now);
                if self.drain_bytes >= MAX_EXIT_DRAIN_BYTES
                    || started.elapsed() >= MAX_EXIT_DRAIN_TIME
                {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "PTY descendants kept producing output after shell exit",
                    ));
                }
            }
            let mut descriptors = [
                libc::pollfd {
                    fd: self.file.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
                libc::pollfd {
                    fd: self.wake.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                },
            ];
            // Infinite sleep while live; after shell exit consume only already-ready output.
            let ready = unsafe {
                libc::poll(
                    descriptors.as_mut_ptr(),
                    descriptors.len() as libc::nfds_t,
                    if draining { 0 } else { -1 },
                )
            };
            if ready < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            if self.control.state.load(Ordering::Acquire) != state {
                continue;
            }
            if descriptors[0].revents == 0 {
                if draining {
                    return Ok(0);
                }
                continue;
            }
            let limit = if draining {
                bytes.len().min(MAX_EXIT_DRAIN_BYTES - self.drain_bytes)
            } else {
                bytes.len()
            };
            match self.file.read(&mut bytes[..limit]) {
                Ok(count) => {
                    if draining {
                        self.drain_bytes += count;
                    }
                    return Ok(count);
                }
                Err(error) if error.raw_os_error() == Some(libc::EIO) => return Ok(0),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn exit_drains_final_output_without_waiting_for_an_inherited_slave_to_close() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let (mut reader, control) = UnixPtyReader::new(pair.master.as_ref()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("printf 'final output\\n'");
        let mut child = pair.slave.spawn_command(command).unwrap();
        // Retaining the slave models a descendant's inherited descriptor after parent exit.
        let (send, receive) = mpsc::channel();
        let worker = thread::spawn(move || {
            let mut output = Vec::new();
            let result = reader.read_to_end(&mut output);
            send.send((result, output)).unwrap();
        });
        child.wait().unwrap();
        control.finish();
        let (result, output) = receive.recv_timeout(Duration::from_secs(2)).unwrap();
        result.unwrap();
        assert_eq!(output, b"final output\r\n");
        worker.join().unwrap();
        drop(pair);
    }

    #[test]
    fn cancellation_wakes_an_idle_reader_with_a_live_slave() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let (mut reader, control) = UnixPtyReader::new(pair.master.as_ref()).unwrap();
        let (send, receive) = mpsc::channel();
        let worker = thread::spawn(move || send.send(reader.read(&mut [0; 16])).unwrap());
        assert!(receive.recv_timeout(Duration::from_millis(20)).is_err());
        control.cancel();
        assert_eq!(
            receive
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap(),
            0
        );
        control.finish();
        assert_eq!(control.state.load(Ordering::Acquire), CANCELLED);
        worker.join().unwrap();
        drop(pair);
    }

    #[test]
    fn reader_drains_large_live_output_through_eof() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let (mut reader, _control) = UnixPtyReader::new(pair.master.as_ref()).unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("dd if=/dev/zero bs=65536 count=64 2>/dev/null");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut count = 0;
        let mut buffer = [0; 16384];
        loop {
            let n = reader.read(&mut buffer).unwrap();
            if n == 0 {
                break;
            }
            assert!(buffer[..n].iter().all(|byte| *byte == 0));
            count += n;
        }
        assert_eq!(count, 4 * 1024 * 1024);
        assert!(child.wait().unwrap().success());
    }

    #[test]
    #[ignore = "manual native PTY throughput comparison, not a timing assertion"]
    fn compare_pollable_and_blocking_reader_throughput() {
        let mut blocking = Vec::new();
        let mut pollable = Vec::new();
        for sample in 0..12 {
            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let mut reader: Box<dyn Read + Send> = if sample % 2 == 0 {
                pair.master.try_clone_reader().unwrap()
            } else {
                Box::new(UnixPtyReader::new(pair.master.as_ref()).unwrap().0)
            };
            let mut command = CommandBuilder::new("/bin/sh");
            command.arg("-c");
            command.arg("dd if=/dev/zero bs=65536 count=512 2>/dev/null");
            let start = Instant::now();
            let mut child = pair.slave.spawn_command(command).unwrap();
            drop(pair.slave);
            let mut count = 0;
            let mut buffer = [0; 16384];
            loop {
                let n = reader.read(&mut buffer).unwrap();
                if n == 0 {
                    break;
                }
                count += n;
            }
            assert_eq!(count, 32 * 1024 * 1024);
            assert!(child.wait().unwrap().success());
            let elapsed = start.elapsed();
            if sample % 2 == 0 {
                blocking.push(elapsed);
            } else {
                pollable.push(elapsed);
            }
        }
        blocking.sort();
        pollable.sort();
        eprintln!(
            "32 MiB PTY drain, six samples each: blocking={blocking:?}, pollable={pollable:?}"
        );
    }
}
