//! Windows Job Object with KILL_ON_JOB_CLOSE for ConPTY children.
//! Dropping the handle kills the whole tree — only reliable orphan guard
//! on Windows.

#![cfg(windows)]

use std::io;
use std::mem::{size_of, zeroed};

use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

pub struct PtyJob {
    handle: HANDLE,
}

// SAFETY: `PtyJob` has unique ownership of a Windows Job HANDLE. Handles are
// reference-counted kernel objects that may be closed from any thread, and this
// type exposes no interior access other than dropping the owned handle.
unsafe impl Send for PtyJob {}
// SAFETY: Shared references cannot mutate the handle value. The only side
// effect is `Drop`, which requires unique ownership of the `PtyJob`.
unsafe impl Sync for PtyJob {}

impl PtyJob {
    pub fn create_for(pid: u32) -> io::Result<Self> {
        // SAFETY: All Win32 calls receive valid pointer arguments for the
        // documented structure sizes. Every owned HANDLE created in this block
        // is either transferred into `PtyJob` or closed on the error path.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() || job == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                let e = io::Error::last_os_error();
                CloseHandle(job);
                return Err(e);
            }

            let process = OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, FALSE, pid);
            if process.is_null() {
                let e = io::Error::last_os_error();
                CloseHandle(job);
                return Err(e);
            }

            let assign = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assign == 0 {
                let e = io::Error::last_os_error();
                CloseHandle(job);
                return Err(e);
            }

            Ok(Self { handle: job })
        }
    }
}

impl Drop for PtyJob {
    fn drop(&mut self) {
        if !self.handle.is_null() && self.handle != INVALID_HANDLE_VALUE {
            // SAFETY: `handle` is owned by this `PtyJob`, checked for sentinel
            // invalid values, and is closed exactly once in `Drop`.
            unsafe { CloseHandle(self.handle) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn create_for_invalid_pid_errors() {
        match PtyJob::create_for(0xFFFFFFFE) {
            Err(_) => {}
            Ok(_) => panic!("invalid pid must error"),
        }
    }

    #[test]
    fn drop_kills_assigned_process_tree() {
        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping -n 30 127.0.0.1 > nul"])
            .spawn()
            .expect("spawn cmd.exe");

        let job = PtyJob::create_for(child.id()).expect("create job");
        drop(job);

        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait().expect("try_wait") {
                Some(_) => break,
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    panic!("child survived 3s after PtyJob drop");
                }
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    }
}
