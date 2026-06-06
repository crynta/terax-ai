use std::path::{Path, PathBuf};

use crate::modules::workspace::WorkspaceEnv;

use super::super::host::PiSessionEventSink;
use super::super::native_tools;
use super::super::types::{PiPromptContext, PiResolvedProviderConfig};

pub(in crate::modules::pi) struct PiHostContext {
    pub(in crate::modules::pi) resource_dir: Option<PathBuf>,
    pub(in crate::modules::pi) event_sink: Option<PiSessionEventSink>,
    pub(in crate::modules::pi) native_tool_context: native_tools::NativeToolContext,
}

impl PiHostContext {
    pub(in crate::modules::pi) fn new(
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
    ) -> Self {
        Self {
            resource_dir: resource_dir.map(Path::to_path_buf),
            event_sink,
            native_tool_context: native_tools::NativeToolContext::default(),
        }
    }

    pub(in crate::modules::pi) fn with_native_tool_context(
        mut self,
        native_tool_context: native_tools::NativeToolContext,
    ) -> Self {
        self.native_tool_context = native_tool_context;
        self
    }
}

pub(in crate::modules::pi) struct CreateSessionRequest {
    pub(in crate::modules::pi) title: Option<String>,
    pub(in crate::modules::pi) cwd: Option<String>,
    pub(in crate::modules::pi) provider_config: Option<PiResolvedProviderConfig>,
    pub(in crate::modules::pi) session_dir: Option<String>,
    pub(in crate::modules::pi) workspace_env: WorkspaceEnv,
}

pub(in crate::modules::pi) struct ResumeSessionRequest {
    pub(in crate::modules::pi) session_id: String,
    pub(in crate::modules::pi) title: String,
    pub(in crate::modules::pi) cwd: String,
    pub(in crate::modules::pi) sdk_session_file: String,
    pub(in crate::modules::pi) session_dir: Option<String>,
    pub(in crate::modules::pi) provider_config: Option<PiResolvedProviderConfig>,
    pub(in crate::modules::pi) created_at: Option<String>,
    pub(in crate::modules::pi) last_prompt: Option<String>,
    pub(in crate::modules::pi) thinking_level: Option<String>,
    pub(in crate::modules::pi) workspace_env: WorkspaceEnv,
}

pub(in crate::modules::pi) struct SendPromptRequest {
    pub(in crate::modules::pi) session_id: String,
    pub(in crate::modules::pi) prompt: String,
    pub(in crate::modules::pi) context: Option<PiPromptContext>,
    pub(in crate::modules::pi) regenerate_branch_group_id: Option<String>,
    pub(in crate::modules::pi) thinking_level: Option<String>,
}

pub(in crate::modules::pi) struct ToolRespondRequest {
    pub(in crate::modules::pi) session_id: String,
    pub(in crate::modules::pi) tool_call_id: String,
    pub(in crate::modules::pi) approved: bool,
}

pub(in crate::modules::pi) struct RenameSessionRequest {
    pub(in crate::modules::pi) session_id: String,
    pub(in crate::modules::pi) title: String,
}

pub(in crate::modules::pi) struct DeleteSessionRequest {
    pub(in crate::modules::pi) session_id: String,
}
