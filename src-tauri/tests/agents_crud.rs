#![cfg(feature = "openclicky")]
use terax_lib::modules::agents::AgentDefinition;

#[test]
fn agent_definition_validation() {
    let valid = AgentDefinition {
        schema_version: 1,
        slug: "test-agent".to_string(),
        display_name: "Test Agent".to_string(),
        description: "A test agent".to_string(),
        accent_color_hex: "#6366f1".to_string(),
        system_prompt: "You are a test agent.".to_string(),
        tool_whitelist: vec!["read_file".to_string(), "grep".to_string()],
        skills: vec![],
        memory: "test memory".to_string(),
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
    };
    assert!(valid.validate().is_ok());

    let no_slug = AgentDefinition {
        slug: "".to_string(),
        ..valid.clone()
    };
    assert!(no_slug.validate().is_err());

    let traversal = AgentDefinition {
        slug: "../escape".to_string(),
        ..valid.clone()
    };
    assert!(traversal.validate().is_err());
}
