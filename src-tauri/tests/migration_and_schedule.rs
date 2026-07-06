#[cfg(feature = "openclicky")]
use terax_lib::modules::agents::migrator::{migrate_agent, OpenClickyAgent};

#[cfg(feature = "openclicky")]
#[test]
fn openclicky_migration() {
    let oc = OpenClickyAgent {
        slug: "my-helper".to_string(),
        soul_md: "You are a helpful assistant.".to_string(),
        instructions_md: "Always be concise.".to_string(),
        memory_md: "User prefers short answers.".to_string(),
    };

    let def = migrate_agent(&oc);

    assert_eq!(def.slug, "my-helper");
    assert_eq!(def.display_name, "My Helper");
    assert!(def.system_prompt.contains("helpful assistant"));
    assert!(def.system_prompt.contains("Always be concise"));
    assert_eq!(def.memory, "User prefers short answers.");
    assert!(def.tool_whitelist.is_empty());
    assert!(def.skills.is_empty());
}

#[cfg(feature = "workflow")]
#[test]
fn cron_expression_validation() {
    use std::str::FromStr;
    let valid = cron::Schedule::from_str("0 0 9 * * *");
    assert!(valid.is_ok());

    let invalid = cron::Schedule::from_str("not a cron");
    assert!(invalid.is_err());
}
