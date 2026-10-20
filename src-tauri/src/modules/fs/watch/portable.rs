//! inotify (Linux) and ReadDirectoryChangesW (Windows) backend via notify.
//! Both are real non-recursive per-directory watches, so only the directories
//! the frontend asked for are registered.

use std::collections::HashSet;
use std::path::PathBuf;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::plan::{self, Batch, WatchSet};
use super::{Backend, Sink};
use crate::modules::fs::to_canon;

pub struct Notify {
    watcher: RecommendedWatcher,
    watched: HashSet<PathBuf>,
}

impl Notify {
    pub fn new(sink: Sink) -> Result<Self, String> {
        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                let Ok(event) = result else { return };
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                let dirs = sink.dirs();
                let mut batch = Batch::default();
                for path in &event.paths {
                    if let Some(dir) = plan::owning_dir(&to_canon(path), &dirs) {
                        if !batch.dirs.contains(&dir) {
                            batch.dirs.push(dir);
                        }
                    }
                }
                sink.send(batch);
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            watcher,
            watched: HashSet::new(),
        })
    }
}

impl Backend for Notify {
    fn sync(&mut self, set: &WatchSet) {
        // Share paths stay in `set` so refcounts and the poller see them, but registering them
        // would only produce a watcher that never fires: the poller owns them instead.
        let wanted: HashSet<PathBuf> = set
            .dir_paths()
            .filter(|dir| !plan::is_wsl_share(&to_canon(dir)))
            .map(PathBuf::from)
            .collect();
        for gone in self.watched.difference(&wanted) {
            let _ = self.watcher.unwatch(gone);
        }
        let mut live = HashSet::with_capacity(wanted.len());
        for dir in wanted {
            if self.watched.contains(&dir) {
                live.insert(dir);
                continue;
            }
            match self.watcher.watch(&dir, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    live.insert(dir);
                }
                Err(e) => log::debug!("fs_watch add {} failed: {e}", dir.display()),
            }
        }
        self.watched = live;
    }
}
