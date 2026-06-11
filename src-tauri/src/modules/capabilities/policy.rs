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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::capabilities::{
        CapabilityKind, CapabilityManifest, CapabilityOrigin, CapabilityTool, RiskLevel,
    };

    fn test_tool(name: &str, approval: ApprovalPolicy) -> CapabilityTool {
        CapabilityTool {
            id: name.to_string(),
            name: name.to_string(),
            label: name.to_string(),
            description: name.to_string(),
            prompt_snippet: name.to_string(),
            prompt_guidelines: vec![],
            parameters: serde_json::json!({}),
            origin: CapabilityOrigin::TeraxCore,
            kind: CapabilityKind::FileRead,
            risk: RiskLevel::Low,
            scopes: vec![],
            approval,
            model_visible: true,
        }
    }

    fn manifest_with(tools: Vec<CapabilityTool>) -> CapabilityManifest {
        CapabilityManifest { version: 1, tools }
    }

    #[test]
    fn auto_tool_passes_without_approval() {
        let manifest = manifest_with(vec![test_tool("t", ApprovalPolicy::Auto)]);
        let result = evaluate(&manifest, "t", CapabilityApprovalState::None);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().approval, ApprovalPolicy::Auto);
    }

    #[test]
    fn ask_tool_requires_approval() {
        let manifest = manifest_with(vec![test_tool("t", ApprovalPolicy::Ask)]);
        let err = evaluate(&manifest, "t", CapabilityApprovalState::None).unwrap_err();
        assert!(matches!(err, CapabilityPolicyError::ApprovalRequired(_)));
    }

    #[test]
    fn ask_tool_passes_when_approved() {
        let manifest = manifest_with(vec![test_tool("t", ApprovalPolicy::Ask)]);
        let result = evaluate(&manifest, "t", CapabilityApprovalState::Approved);
        assert!(result.is_ok());
    }

    #[test]
    fn denied_tool_always_fails() {
        let manifest = manifest_with(vec![test_tool("t", ApprovalPolicy::Deny)]);
        let err = evaluate(&manifest, "t", CapabilityApprovalState::Approved).unwrap_err();
        assert!(matches!(err, CapabilityPolicyError::Denied(_)));
    }

    #[test]
    fn unknown_tool_errors() {
        let manifest = manifest_with(vec![test_tool("a", ApprovalPolicy::Auto)]);
        let err = evaluate(&manifest, "b", CapabilityApprovalState::None).unwrap_err();
        assert!(matches!(err, CapabilityPolicyError::UnknownTool(_)));
    }

    #[test]
    fn decision_preserves_tool_metadata() {
        let manifest = manifest_with(vec![test_tool("t", ApprovalPolicy::Auto)]);
        let decision = evaluate(&manifest, "t", CapabilityApprovalState::None).unwrap();
        assert_eq!(decision.tool_name, "t");
        assert_eq!(decision.risk, RiskLevel::Low);
        assert_eq!(decision.origin, CapabilityOrigin::TeraxCore);
    }

    #[test]
    fn error_display_includes_tool_name() {
        let msg = CapabilityPolicyError::Denied("my_tool".into()).to_string();
        assert!(msg.contains("my_tool"));
    }
}
