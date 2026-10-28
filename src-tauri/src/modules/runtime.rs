//! The async runtime behind Tauri commands.
//!
//! Tauri's default is a multi-threaded tokio runtime with a worker per core and
//! up to 512 blocking threads. Nothing here is CPU-bound async work: commands
//! await sockets and channels, and anything that touches the disk or waits on a
//! process runs on the blocking pool. Two workers drive all of that, so an idle
//! app keeps two parked threads instead of one per core.

use std::io;
use std::sync::OnceLock;

use tokio::runtime::{Builder, Runtime};

const WORKER_THREADS: usize = 2;
/// Blocking tasks are file walks, git and shell children, keychain calls. A
/// burst beyond this queues instead of spawning hundreds of threads.
const MAX_BLOCKING_THREADS: usize = 48;
const THREAD_STACK: usize = 1024 * 1024;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn build(workers: usize, max_blocking: usize) -> io::Result<Runtime> {
    Builder::new_multi_thread()
        .worker_threads(workers)
        .max_blocking_threads(max_blocking)
        .thread_name("terax-async")
        .thread_stack_size(THREAD_STACK)
        .enable_all()
        .build()
}

/// Must run before anything touches `tauri::async_runtime`. Falls back to
/// Tauri's own runtime if ours cannot be built.
pub fn install() {
    match build(WORKER_THREADS, MAX_BLOCKING_THREADS) {
        Ok(runtime) => {
            let handle = runtime.handle().clone();
            if RUNTIME.set(runtime).is_ok() {
                tauri::async_runtime::set(handle);
            }
        }
        Err(error) => log::warn!("could not build the async runtime, using the default: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    #[test]
    fn workers_are_few_and_named() {
        let runtime = build(WORKER_THREADS, MAX_BLOCKING_THREADS).unwrap();
        let names: std::collections::HashSet<String> = runtime.block_on(async {
            let mut tasks = Vec::new();
            for _ in 0..64 {
                tasks.push(tokio::spawn(async {
                    tokio::task::yield_now().await;
                    std::thread::current().name().unwrap_or("").to_string()
                }));
            }
            let mut names = std::collections::HashSet::new();
            for task in tasks {
                names.insert(task.await.unwrap());
            }
            names
        });
        assert!(names.iter().all(|n| n == "terax-async" || n.is_empty()));
        assert!(names.len() <= WORKER_THREADS + 1);
    }

    #[test]
    fn blocking_work_does_not_starve_the_async_workers() {
        let runtime = build(WORKER_THREADS, MAX_BLOCKING_THREADS).unwrap();
        runtime.block_on(async {
            let gate = Arc::new(Barrier::new(9));
            let mut blockers = Vec::new();
            for _ in 0..8 {
                let gate = gate.clone();
                blockers.push(tokio::task::spawn_blocking(move || {
                    gate.wait();
                }));
            }
            // Eight blocked threads, yet async tasks still make progress.
            let progressed = tokio::time::timeout(Duration::from_secs(5), async {
                for _ in 0..100 {
                    tokio::task::yield_now().await;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            })
            .await;
            assert!(progressed.is_ok());
            gate.wait();
            for blocker in blockers {
                blocker.await.unwrap();
            }
        });
    }

    #[test]
    fn the_blocking_pool_is_bounded() {
        let runtime = build(WORKER_THREADS, 4).unwrap();
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        runtime.block_on(async {
            let mut tasks = Vec::new();
            for _ in 0..16 {
                let (running, peak) = (running.clone(), peak.clone());
                tasks.push(tokio::task::spawn_blocking(move || {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    running.fetch_sub(1, Ordering::SeqCst);
                }));
            }
            for task in tasks {
                task.await.unwrap();
            }
        });
        assert!(peak.load(Ordering::SeqCst) <= 4);
    }
}
