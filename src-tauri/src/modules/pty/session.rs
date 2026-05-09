use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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
    Cwd { cwd: String },
    Exit { code: i32 },
}

// Cwd polling cadence. Fast enough that `cd` feels instant in the sidebar,
// slow enough that the per-tab cost is negligible (one syscall per tick).
const CWD_POLL_INTERVAL: Duration = Duration::from_millis(400);

/// Read the cwd of a process by PID. Used as a fallback when the shell's OSC 7
/// integration isn't emitting (custom .zshrc that stomps precmd hooks, foreign
/// shells, etc.). Returns None when the platform is unsupported or the syscall
/// fails (typically: process exited between the poll and this call).
#[cfg(target_os = "macos")]
fn read_pid_cwd(pid: u32) -> Option<String> {
    use libproc::libproc::proc_pid::{pidinfo, PIDInfo, PidInfoFlavor};

    // Mirrors macOS `struct vinfo_stat` (sys/proc_info.h). We never read these
    // fields — the struct only exists so the surrounding layout matches what
    // the kernel writes via PROC_PIDVNODEPATHINFO.
    #[repr(C)]
    #[allow(dead_code)]
    struct VinfoStat {
        vst_dev: u32,
        vst_mode: u16,
        vst_nlink: u16,
        vst_ino: u64,
        vst_uid: u32,
        vst_gid: u32,
        vst_atime: i64,
        vst_atimensec: i64,
        vst_mtime: i64,
        vst_mtimensec: i64,
        vst_ctime: i64,
        vst_ctimensec: i64,
        vst_birthtime: i64,
        vst_birthtimensec: i64,
        vst_size: i64,
        vst_blocks: i64,
        vst_blksize: i32,
        vst_flags: u32,
        vst_gen: u32,
        vst_rdev: u32,
        vst_qspare: [i64; 2],
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct VnodeInfo {
        vi_stat: VinfoStat,
        vi_type: i32,
        vi_pad: i32,
        vi_fsid: [u32; 2],
    }

    const MAXPATHLEN: usize = 1024;

    #[repr(C)]
    struct VnodeInfoPath {
        _vip_vi: VnodeInfo,
        vip_path: [u8; MAXPATHLEN],
    }

    #[repr(C)]
    struct ProcVnodePathInfo {
        pvi_cdir: VnodeInfoPath,
        _pvi_rdir: VnodeInfoPath,
    }

    impl PIDInfo for ProcVnodePathInfo {
        fn flavor() -> PidInfoFlavor {
            PidInfoFlavor::VNodePathInfo
        }
    }

    let info = pidinfo::<ProcVnodePathInfo>(pid as i32, 0).ok()?;
    let bytes = &info.pvi_cdir.vip_path;
    let nul = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    if nul == 0 {
        return None;
    }
    std::str::from_utf8(&bytes[..nul])
        .ok()
        .map(|s| s.to_string())
}

#[cfg(target_os = "linux")]
fn read_pid_cwd(pid: u32) -> Option<String> {
    let link = format!("/proc/{pid}/cwd");
    let path = std::fs::read_link(link).ok()?;
    path.into_os_string().into_string().ok()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn read_pid_cwd(_pid: u32) -> Option<String> {
    None
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

pub fn spawn(
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<(Arc<Session>, PtySize), String> {
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
    let child_pid = child.process_id();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
    });

    let pending: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(READ_BUF)));
    let done = Arc::new(AtomicBool::new(false));

    let pending_r = pending.clone();
    let reader_thread = thread::Builder::new()
        .name("terax-pty-reader".into())
        .spawn(move || {
            let mut buf = [0u8; READ_BUF];
            let mut dropped_bytes: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
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

    // Backend cwd poller. Falls back from OSC 7 by reading the shell's cwd
    // straight from the kernel — works regardless of what the user's shell
    // rcfiles do to precmd/preexec hooks. Emits only on change.
    if let Some(pid) = child_pid {
        let on_event_cwd = on_event.clone();
        let done_c = done.clone();
        thread::Builder::new()
            .name("terax-pty-cwd-poller".into())
            .spawn(move || {
                let mut last: Option<String> = None;
                loop {
                    if done_c.load(Ordering::Acquire) {
                        break;
                    }
                    if let Some(cwd) = read_pid_cwd(pid) {
                        if last.as_deref() != Some(cwd.as_str()) {
                            if let Err(e) = on_event_cwd.send(PtyEvent::Cwd { cwd: cwd.clone() }) {
                                log::debug!("pty cwd poller exiting, channel closed: {e}");
                                break;
                            }
                            last = Some(cwd);
                        }
                    }
                    thread::sleep(CWD_POLL_INTERVAL);
                }
            })
            .expect("spawn pty cwd poller thread");
    }

    let on_event_exit = on_event;
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
