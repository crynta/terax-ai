//! Git integration: repository discovery, status, diff, staging, commit, push/pull, and log operations backed by the `git` CLI.

pub mod commands;
pub mod errors;
pub mod operations;
pub mod parser;
mod process;
pub mod types;
pub mod utils;
