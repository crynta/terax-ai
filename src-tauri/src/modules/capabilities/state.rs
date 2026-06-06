use std::sync::atomic::{AtomicU64, Ordering};

use serde::Deserialize;

use super::{app_capability_manifest, audit, policy, workflow_capability_manifest};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPolicyContext {
    pub approved: bool,
    pub document_id: String,
    pub node_id: String,
}

#[derive(Clone, Default)]
pub struct WorkflowCapabilityState {
    capability_audit: audit::CapabilityAuditLog,
}

impl WorkflowCapabilityState {
    pub fn capability_audit_entries(&self) -> Vec<audit::CapabilityAuditEntry> {
        self.capability_audit.entries()
    }

    pub fn execute_workflow_capability<T>(
        &self,
        context: &WorkflowPolicyContext,
        tool_name: &str,
        execute: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.evaluate_workflow_capability(context, tool_name)?;
        let result = execute();
        self.record_workflow_capability_result(context, tool_name, &result);
        result
    }

    pub async fn execute_workflow_capability_async<T, Fut>(
        &self,
        context: &WorkflowPolicyContext,
        tool_name: &str,
        execute: impl FnOnce() -> Fut,
    ) -> Result<T, String>
    where
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        self.evaluate_workflow_capability(context, tool_name)?;
        let result = execute().await;
        self.record_workflow_capability_result(context, tool_name, &result);
        result
    }

    fn evaluate_workflow_capability(
        &self,
        context: &WorkflowPolicyContext,
        tool_name: &str,
    ) -> Result<(), String> {
        let approval_state = if context.approved {
            policy::CapabilityApprovalState::Approved
        } else {
            policy::CapabilityApprovalState::None
        };
        if let Err(error) =
            policy::evaluate(&workflow_capability_manifest(), tool_name, approval_state)
        {
            let message = error.to_string();
            self.capability_audit
                .record(audit::CapabilityAuditEntry::new(
                    &context.document_id,
                    &context.node_id,
                    tool_name,
                    context.approved,
                    false,
                    audit::CapabilityAuditOutcome::Blocked,
                    Some(message.clone()),
                ));
            return Err(message);
        }
        Ok(())
    }

    fn record_workflow_capability_result<T>(
        &self,
        context: &WorkflowPolicyContext,
        tool_name: &str,
        result: &Result<T, String>,
    ) {
        match result {
            Ok(_) => {
                self.capability_audit
                    .record(audit::CapabilityAuditEntry::new(
                        &context.document_id,
                        &context.node_id,
                        tool_name,
                        context.approved,
                        true,
                        audit::CapabilityAuditOutcome::Succeeded,
                        None,
                    ));
            }
            Err(error) => {
                self.capability_audit
                    .record(audit::CapabilityAuditEntry::new(
                        &context.document_id,
                        &context.node_id,
                        tool_name,
                        context.approved,
                        true,
                        audit::CapabilityAuditOutcome::Failed,
                        Some(error.clone()),
                    ));
            }
        }
    }
}

#[derive(Default)]
pub struct AppCapabilityState {
    capability_audit: audit::CapabilityAuditLog,
    next_operation_id: AtomicU64,
}

impl AppCapabilityState {
    pub fn capability_audit_entries(&self) -> Vec<audit::CapabilityAuditEntry> {
        self.capability_audit.entries()
    }

    pub fn execute_app_capability<T>(
        &self,
        tool_name: &str,
        execute: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let operation_id = self.next_operation_id();
        self.evaluate_app_capability(tool_name, &operation_id)?;
        let result = execute();
        self.record_app_capability_result(tool_name, &operation_id, &result);
        result
    }

    pub async fn execute_app_capability_async<T, Fut>(
        &self,
        tool_name: &str,
        execute: impl FnOnce() -> Fut,
    ) -> Result<T, String>
    where
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let operation_id = self.next_operation_id();
        self.evaluate_app_capability(tool_name, &operation_id)?;
        let result = execute().await;
        self.record_app_capability_result(tool_name, &operation_id, &result);
        result
    }

    fn next_operation_id(&self) -> String {
        let sequence = self.next_operation_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("app-{sequence}")
    }

    fn evaluate_app_capability(&self, tool_name: &str, operation_id: &str) -> Result<(), String> {
        if let Err(error) = policy::evaluate(
            &app_capability_manifest(),
            tool_name,
            policy::CapabilityApprovalState::None,
        ) {
            let message = error.to_string();
            self.capability_audit
                .record(audit::CapabilityAuditEntry::new(
                    "app",
                    operation_id,
                    tool_name,
                    false,
                    false,
                    audit::CapabilityAuditOutcome::Blocked,
                    Some(message.clone()),
                ));
            return Err(message);
        }
        Ok(())
    }

    fn record_app_capability_result<T>(
        &self,
        tool_name: &str,
        operation_id: &str,
        result: &Result<T, String>,
    ) {
        match result {
            Ok(_) => {
                self.capability_audit
                    .record(audit::CapabilityAuditEntry::new(
                        "app",
                        operation_id,
                        tool_name,
                        false,
                        true,
                        audit::CapabilityAuditOutcome::Succeeded,
                        None,
                    ));
            }
            Err(error) => {
                self.capability_audit
                    .record(audit::CapabilityAuditEntry::new(
                        "app",
                        operation_id,
                        tool_name,
                        false,
                        true,
                        audit::CapabilityAuditOutcome::Failed,
                        Some(error.clone()),
                    ));
            }
        }
    }
}
