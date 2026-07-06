//! Application modules: each sub-module owns a domain (PTY, filesystem, git, Pi AI, etc.) and exposes Tauri IPC commands plus shared state types.

pub mod agent;
#[cfg(feature = "openclicky")]
pub mod agents;
pub mod artifacts;
pub mod browser;
pub mod capabilities;
pub mod capture;
pub mod fs;
pub mod git;
pub mod mcp;
pub mod model_compare;
pub mod net;
pub mod overlay;
pub mod pi;
pub mod proc;
pub mod pty;
#[cfg(feature = "workflow")]
pub mod schedule;
pub mod secrets;
pub mod shell;
pub mod skills;
pub(crate) mod sync;
#[cfg(all(target_os = "macos", feature = "openclicky"))]
pub mod tray;
#[cfg(feature = "openclicky")]
pub mod voice;
#[cfg(feature = "workflow")]
pub mod webhook;
pub mod workspace;
