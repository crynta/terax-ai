use std::path::Path;

use crate::modules::workspace::WorkspaceEnv;

use super::{native_tools, PiState};
use crate::modules::pi::host::PiSessionEventSink;
use crate::modules::pi::types::*;

impl PiState {
    pub fn session_create_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
        cwd: Option<String>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_provider(resource_dir, title, cwd, None)
    }

    fn session_create_with_resource_dir_and_provider(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_provider_and_session_dir(
            resource_dir,
            title,
            cwd,
            provider_config,
            None,
        )
    }

    pub fn session_create_with_resource_dir_and_session_dir(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
        cwd: Option<String>,
        session_dir: Option<String>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_provider_and_session_dir(
            resource_dir,
            title,
            cwd,
            None,
            session_dir,
        )
    }

    fn session_create_with_resource_dir_and_provider_and_session_dir(
        &self,
        resource_dir: Option<&Path>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
        session_dir: Option<String>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.with_host(resource_dir, |host| {
            host.session_create(
                title,
                cwd,
                provider_config,
                session_dir,
                WorkspaceEnv::Local,
            )
        })
    }

    pub fn session_create_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_event_sink_and_provider(
            resource_dir,
            event_sink,
            title,
            cwd,
            None,
        )
    }

    pub fn session_create_with_resource_dir_and_event_sink_and_session_dir(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
        session_dir: Option<String>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_event_sink_and_provider_and_session_dir(
            resource_dir,
            event_sink,
            title,
            cwd,
            None,
            session_dir,
            WorkspaceEnv::Local,
            native_tools::NativeToolContext::default(),
        )
    }

    fn session_create_with_resource_dir_and_event_sink_and_provider(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.session_create_with_resource_dir_and_event_sink_and_provider_and_session_dir(
            resource_dir,
            event_sink,
            title,
            cwd,
            provider_config,
            None,
            WorkspaceEnv::Local,
            native_tools::NativeToolContext::default(),
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Event sink, provider config, and persistent session directory are forwarded"
    )]
    pub(super) fn session_create_with_resource_dir_and_event_sink_and_provider_and_session_dir(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        title: Option<String>,
        cwd: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
        session_dir: Option<String>,
        workspace_env: WorkspaceEnv,
        native_tool_context: native_tools::NativeToolContext,
    ) -> PiCommandResult<PiSessionCreateResult> {
        self.with_host_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tool_context,
            |host| host.session_create(title, cwd, provider_config, session_dir, workspace_env),
        )
    }

    pub fn session_resume_with_resource_dir_and_session_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        title: String,
        cwd: String,
        sdk_session_file: String,
        session_dir: Option<String>,
    ) -> PiCommandResult<PiSessionResumeResult> {
        self.session_resume_with_resource_dir_and_event_sink_and_provider(
            resource_dir,
            None,
            session_id,
            title,
            cwd,
            sdk_session_file,
            session_dir,
            None,
            None,
            None,
            None,
            WorkspaceEnv::Local,
            native_tools::NativeToolContext::default(),
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Pi resume forwards persisted session metadata to the sidecar"
    )]
    pub(super) fn session_resume_with_resource_dir_and_event_sink_and_provider(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        title: String,
        cwd: String,
        sdk_session_file: String,
        session_dir: Option<String>,
        provider_config: Option<PiResolvedProviderConfig>,
        created_at: Option<String>,
        last_prompt: Option<String>,
        thinking_level: Option<String>,
        workspace_env: WorkspaceEnv,
        native_tool_context: native_tools::NativeToolContext,
    ) -> PiCommandResult<PiSessionResumeResult> {
        self.with_host_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tool_context,
            |host| {
                host.session_resume(
                    session_id,
                    title,
                    cwd,
                    sdk_session_file,
                    session_dir,
                    provider_config,
                    created_at,
                    last_prompt,
                    thinking_level,
                    workspace_env,
                )
            },
        )
    }

    pub fn session_send_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
        regenerate_branch_group_id: Option<String>,
        thinking_level: Option<String>,
    ) -> PiCommandResult<PiSessionSendResult> {
        self.with_host(resource_dir, |host| {
            host.session_send(
                session_id,
                prompt,
                context,
                regenerate_branch_group_id,
                thinking_level,
            )
        })
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Event sink and optional send metadata are forwarded to the Pi host"
    )]
    pub fn session_send_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
        regenerate_branch_group_id: Option<String>,
        thinking_level: Option<String>,
    ) -> PiCommandResult<PiSessionSendResult> {
        self.session_send_with_resource_dir_and_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tools::NativeToolContext::default(),
            session_id,
            prompt,
            context,
            regenerate_branch_group_id,
            thinking_level,
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Event sink, native tool context, and optional send metadata are forwarded"
    )]
    pub(super) fn session_send_with_resource_dir_and_event_sink_and_native_tool_context(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
        session_id: String,
        prompt: String,
        context: Option<PiPromptContext>,
        regenerate_branch_group_id: Option<String>,
        thinking_level: Option<String>,
    ) -> PiCommandResult<PiSessionSendResult> {
        self.with_host_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tool_context,
            |host| {
                host.session_send(
                    session_id,
                    prompt,
                    context,
                    regenerate_branch_group_id,
                    thinking_level,
                )
            },
        )
    }

    pub fn session_tool_respond_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        tool_call_id: String,
        approved: bool,
    ) -> PiCommandResult<PiSessionToolRespondResult> {
        self.with_host(resource_dir, |host| {
            host.session_tool_respond(session_id, tool_call_id, approved)
        })
    }

    pub fn session_tool_respond_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        tool_call_id: String,
        approved: bool,
    ) -> PiCommandResult<PiSessionToolRespondResult> {
        self.session_tool_respond_with_resource_dir_and_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tools::NativeToolContext::default(),
            session_id,
            tool_call_id,
            approved,
        )
    }

    pub(super) fn session_tool_respond_with_resource_dir_and_event_sink_and_native_tool_context(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        native_tool_context: native_tools::NativeToolContext,
        session_id: String,
        tool_call_id: String,
        approved: bool,
    ) -> PiCommandResult<PiSessionToolRespondResult> {
        self.with_host_event_sink_and_native_tool_context(
            resource_dir,
            event_sink,
            native_tool_context,
            |host| host.session_tool_respond(session_id, tool_call_id, approved),
        )
    }

    pub fn session_rename_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
        title: String,
    ) -> PiCommandResult<PiSessionRenameResult> {
        self.with_host(resource_dir, |host| host.session_rename(session_id, title))
    }

    pub fn session_rename_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
        title: String,
    ) -> PiCommandResult<PiSessionRenameResult> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_rename(session_id, title)
        })
    }

    pub fn session_delete_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
    ) -> PiCommandResult<PiSessionDeleteResult> {
        self.with_host(resource_dir, |host| host.session_delete(session_id))
    }

    pub fn session_delete_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
    ) -> PiCommandResult<PiSessionDeleteResult> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_delete(session_id)
        })
    }

    pub fn session_stop_with_resource_dir(
        &self,
        resource_dir: Option<&Path>,
        session_id: String,
    ) -> PiCommandResult<PiSessionStopResult> {
        self.with_host(resource_dir, |host| host.session_stop(session_id))
    }

    pub fn session_stop_with_resource_dir_and_event_sink(
        &self,
        resource_dir: Option<&Path>,
        event_sink: Option<PiSessionEventSink>,
        session_id: String,
    ) -> PiCommandResult<PiSessionStopResult> {
        self.with_host_event_sink(resource_dir, event_sink, |host| {
            host.session_stop(session_id)
        })
    }
}
