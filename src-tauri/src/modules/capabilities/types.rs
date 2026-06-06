use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CAPABILITY_MANIFEST_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityManifest {
    pub version: u32,
    pub tools: Vec<CapabilityTool>,
}

impl CapabilityManifest {
    pub fn enabled_tool_names(&self) -> Vec<String> {
        self.tools
            .iter()
            .filter(|tool| tool.model_visible && tool.approval != ApprovalPolicy::Deny)
            .map(|tool| tool.name.clone())
            .collect()
    }

    pub fn approval_required_tool_names(&self) -> Vec<String> {
        self.tools
            .iter()
            .filter(|tool| tool.approval == ApprovalPolicy::Ask)
            .map(|tool| tool.name.clone())
            .collect()
    }

    pub fn tool(&self, name: &str) -> Option<&CapabilityTool> {
        self.tools.iter().find(|tool| tool.name == name)
    }

    pub fn tool_mut(&mut self, name: &str) -> Option<&mut CapabilityTool> {
        self.tools.iter_mut().find(|tool| tool.name == name)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityTool {
    pub id: String,
    pub name: String,
    pub label: String,
    pub description: String,
    pub prompt_snippet: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prompt_guidelines: Vec<String>,
    pub parameters: Value,
    pub origin: CapabilityOrigin,
    pub kind: CapabilityKind,
    pub risk: RiskLevel,
    pub scopes: Vec<String>,
    pub approval: ApprovalPolicy,
    pub model_visible: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityOrigin {
    TeraxCore,
    Workflow,
    Mcp,
    LocalAgent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityKind {
    FileRead,
    FileList,
    FileSearch,
    FileWrite,
    ProcessExec,
    ArtifactRead,
    ArtifactWrite,
    HttpRequest,
    AgentRun,
    BrowserAutomation,
    McpTool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalPolicy {
    Auto,
    Ask,
    Deny,
}
