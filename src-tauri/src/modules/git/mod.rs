pub mod branch;
pub mod checkpoint;
pub mod commands;
pub mod commands_review;
pub mod diff;
#[cfg(test)]
mod edge_tests;
pub mod errors;
#[cfg(test)]
mod feedback_tests;
#[cfg(test)]
mod followup_tests;
#[cfg(test)]
mod hardening_tests;
pub mod operations;
pub mod parser;
pub mod patch;
mod plumbing;
mod process;
pub mod refs;
pub mod review;
#[cfg(test)]
pub(crate) mod review_tests;
#[cfg(test)]
mod tasks_tests;
#[cfg(test)]
mod testutil;
pub mod types;
mod untracked;
pub mod utils;
pub mod watch;
pub mod worktree;

pub mod commands_tasks;
pub mod project_config;
mod task_state;
pub mod task_worktree;
#[cfg(test)]
mod task_worktree_tests;
