use terax_lib::modules::skills::scanner::{is_valid_skill_name, frontmatter_value};

#[test]
fn skill_name_validation() {
    assert!(is_valid_skill_name("code-reviewer"));
    assert!(is_valid_skill_name("a"));
    assert!(!is_valid_skill_name(""));
    assert!(!is_valid_skill_name("has spaces"));
    assert!(!is_valid_skill_name("has/slash"));
    assert!(!is_valid_skill_name("has.dot"));
    assert!(!is_valid_skill_name("has_underscore"));
    assert!(!is_valid_skill_name("Has-Caps"));
    assert!(!is_valid_skill_name("-starts-dash"));
    assert!(!is_valid_skill_name("ends-dash-"));
    assert!(!is_valid_skill_name("double--dash"));
}

#[test]
fn frontmatter_extraction() {
    let content = "---\nname: test-skill\nversion: \"1.0\"\n---\n\n# Instructions\nDo stuff.";
    assert_eq!(frontmatter_value(content, "name"), Some("test-skill".to_string()));
    assert_eq!(frontmatter_value(content, "version"), Some("1.0".to_string()));
    assert_eq!(frontmatter_value(content, "missing"), None);

    let no_fm = "# Just a heading\nNo frontmatter here.";
    assert_eq!(frontmatter_value(no_fm, "name"), None);
}
