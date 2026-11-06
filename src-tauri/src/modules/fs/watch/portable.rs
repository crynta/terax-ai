//! inotify (Linux) and ReadDirectoryChangesW (Windows) backend via notify.
//! Both are real non-recursive per-directory watches, so only the directories
//! the frontend asked for are registered.

use std::collections::HashSet;
use std::path::PathBuf;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::plan::{self, Batch, ListingChange, WatchSet};
use super::{Backend, Sink};
use crate::modules::fs::to_canon;

pub struct Notify {
    watcher: RecommendedWatcher,
    watched: HashSet<PathBuf>,
}

fn listing_change(event: &Event) -> ListingChange {
    let content_only = matches!(
        event.kind,
        EventKind::Modify(notify::event::ModifyKind::Data(_))
    ) && !event.need_rescan()
        && event.paths.iter().all(|path| {
            !matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some(".gitignore" | ".ignore")
            )
        });
    ListingChange {
        content_only,
        forced: !content_only,
    }
}

impl Notify {
    pub fn new(sink: Sink) -> Result<Self, String> {
        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<Event>| {
                let Ok(event) = result else { return };
                if matches!(event.kind, EventKind::Access(_)) && !event.need_rescan() {
                    return;
                }
                let dirs = sink.dirs();
                let mut batch = Batch {
                    listing: listing_change(&event),
                    ..Batch::default()
                };
                if event.need_rescan() {
                    batch.subtrees = dirs
                        .iter()
                        .filter_map(|dir| String::from_utf8(dir.clone()).ok())
                        .collect();
                }
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
        let wanted: HashSet<PathBuf> = set.dir_paths().map(PathBuf::from).collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{DataChange, Flag, ModifyKind, RenameMode};

    #[test]
    fn only_certain_non_ignore_content_edits_skip_listing_checks() {
        let edit = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(PathBuf::from("/root/file.txt"));
        assert!(listing_change(&edit).content_only);
        for name in [".gitignore", ".ignore"] {
            let ignore = Event::new(edit.kind).add_path(PathBuf::from("/root").join(name));
            assert!(listing_change(&ignore).forced);
        }
        let rename = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)));
        assert!(listing_change(&rename).forced);
        assert!(listing_change(&Event::new(EventKind::Any)).forced);
        assert!(listing_change(&edit.set_flag(Flag::Rescan)).forced);
    }
}
