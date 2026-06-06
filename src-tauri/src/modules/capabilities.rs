pub mod audit;
mod manifests;
pub mod policy;
mod schemas;
mod state;
mod types;

pub use manifests::{
    app_capability_manifest, capability_manifest_with_mcp_tools, core_capability_manifest,
    workflow_capability_manifest,
};
pub use state::{AppCapabilityState, WorkflowCapabilityState, WorkflowPolicyContext};
pub use types::*;

#[tauri::command]
pub fn workflow_capability_audit(
    state: tauri::State<WorkflowCapabilityState>,
) -> Result<Vec<audit::CapabilityAuditEntry>, String> {
    Ok(state.capability_audit_entries())
}

#[tauri::command]
pub fn app_capability_audit(
    state: tauri::State<AppCapabilityState>,
) -> Result<Vec<audit::CapabilityAuditEntry>, String> {
    Ok(state.capability_audit_entries())
}
