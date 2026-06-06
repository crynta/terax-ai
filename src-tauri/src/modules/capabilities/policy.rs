use super::{ApprovalPolicy, CapabilityManifest, CapabilityOrigin, RiskLevel};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapabilityApprovalState {
    None,
    Approved,
    Denied,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapabilityDecision {
    pub tool_name: String,
    pub approval: ApprovalPolicy,
    pub risk: RiskLevel,
    pub origin: CapabilityOrigin,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CapabilityPolicyError {
    UnknownTool(String),
    ApprovalRequired(String),
    Denied(String),
}

impl std::fmt::Display for CapabilityPolicyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownTool(tool) => write!(formatter, "unknown capability tool: {tool}"),
            Self::ApprovalRequired(tool) => {
                write!(formatter, "capability tool requires approval: {tool}")
            }
            Self::Denied(tool) => write!(formatter, "capability tool is denied: {tool}"),
        }
    }
}

impl std::error::Error for CapabilityPolicyError {}

pub fn evaluate(
    manifest: &CapabilityManifest,
    tool_name: &str,
    approval_state: CapabilityApprovalState,
) -> Result<CapabilityDecision, CapabilityPolicyError> {
    let tool = manifest
        .tool(tool_name)
        .ok_or_else(|| CapabilityPolicyError::UnknownTool(tool_name.to_string()))?;
    match tool.approval {
        ApprovalPolicy::Deny => Err(CapabilityPolicyError::Denied(tool.name.clone())),
        ApprovalPolicy::Ask if approval_state != CapabilityApprovalState::Approved => {
            Err(CapabilityPolicyError::ApprovalRequired(tool.name.clone()))
        }
        ApprovalPolicy::Ask | ApprovalPolicy::Auto => Ok(CapabilityDecision {
            tool_name: tool.name.clone(),
            approval: tool.approval,
            risk: tool.risk,
            origin: tool.origin,
        }),
    }
}
