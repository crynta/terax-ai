use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::errors::{GitError, Result};
use super::project_config::Ports;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Creating,
    Active,
    Archived,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub name: String,
    pub root: String,
    pub path: String,
    pub branch: String,
    pub status: TaskStatus,
    pub port: u16,
    pub port_count: u16,
    pub snapshot: Option<TaskSnapshot>,
    pub archive_script: String,
    pub include: Vec<String>,
    pub shared: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub reference: String,
    pub commit: String,
    pub parent: String,
    pub captures_ignored_files: bool,
}

#[derive(Default, Deserialize, Serialize)]
struct State {
    tasks: Vec<TaskRecord>,
}

pub(crate) struct Store {
    _lock: File,
    path: PathBuf,
    state: State,
}

impl Store {
    pub fn open(home: &Path) -> Result<Self> {
        let dir = home.join(".terax");
        std::fs::create_dir_all(&dir)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("task-worktrees.lock"))?;
        lock.lock()
            .map_err(|e| GitError::command("task store lock", e.to_string()))?;
        let path = dir.join("task-worktrees.json");
        let state = match File::open(&path) {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(4 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err(GitError::command("task store", "exceeds 4 MiB"));
                }
                serde_json::from_slice(&bytes)
                    .map_err(|e| GitError::command("task store", e.to_string()))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            _lock: lock,
            path,
            state,
        })
    }

    pub fn tasks(&self) -> &[TaskRecord] {
        &self.state.tasks
    }

    pub fn task(&self, root: &str, id: &str) -> Result<TaskRecord> {
        self.state
            .tasks
            .iter()
            .find(|t| t.id == id && t.root == root)
            .cloned()
            .ok_or_else(|| GitError::command("task", "task does not belong to this repository"))
    }

    pub fn put(&mut self, task: TaskRecord) -> Result<()> {
        if let Some(existing) = self.state.tasks.iter_mut().find(|t| t.id == task.id) {
            *existing = task;
        } else {
            self.state.tasks.push(task);
        }
        self.save()
    }

    pub fn forget(&mut self, id: &str) -> Result<()> {
        self.state.tasks.retain(|t| t.id != id);
        self.save()
    }

    fn save(&self) -> Result<()> {
        let bytes = serde_json::to_vec(&self.state)
            .map_err(|e| GitError::command("task store", e.to_string()))?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(GitError::command("task store", "exceeds 4 MiB"));
        }
        let mut tmp = tempfile::NamedTempFile::new_in(self.path.parent().expect("store parent"))?;
        tmp.write_all(&bytes)?;
        tmp.as_file().sync_all()?;
        tmp.persist(&self.path).map_err(|e| e.error)?;
        #[cfg(unix)]
        File::open(self.path.parent().expect("store parent"))?.sync_all()?;
        Ok(())
    }

    pub fn allocate(&self, ports: &Ports, preferred: Option<u16>) -> Result<u16> {
        let fits = |base: u16| {
            let end = u32::from(base) + u32::from(ports.per_task);
            base > 0
                && end <= 65536
                && !self.state.tasks.iter().any(|t| {
                    t.status != TaskStatus::Archived
                        && u32::from(base) < u32::from(t.port) + u32::from(t.port_count)
                        && u32::from(t.port) < end
                })
        };
        if let Some(base) = preferred.filter(|base| fits(*base)) {
            return Ok(base);
        }
        for base in (u32::from(ports.base)..=65535).step_by(usize::from(ports.per_task)) {
            if fits(base as u16) {
                return Ok(base as u16);
            }
        }
        Err(GitError::command("task ports", "no free port block"))
    }
}
