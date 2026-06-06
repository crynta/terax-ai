use super::*;

#[test]
fn sha_is_safe_accepts_hex() {
    assert!(sha_is_safe("abc123"));
    assert!(sha_is_safe(&"a".repeat(40)));
    assert!(sha_is_safe(&"f".repeat(64)));
}

#[test]
fn sha_is_safe_rejects_non_hex_or_oversize() {
    assert!(!sha_is_safe(""));
    assert!(!sha_is_safe("abcg"));
    assert!(!sha_is_safe("abc 123"));
    assert!(!sha_is_safe(&"a".repeat(65)));
    assert!(!sha_is_safe(";rm -rf /"));
}

#[test]
fn is_remote_name_char_allows_word_and_punct() {
    for c in "abcXYZ012-_.".chars() {
        assert!(is_remote_name_char(c));
    }
    for c in " /:\\?\"'".chars() {
        assert!(!is_remote_name_char(c));
    }
}

#[test]
fn parse_shortstat_pulls_three_counts() {
    let line = " 5 files changed, 12 insertions(+), 3 deletions(-)";
    assert_eq!(parse_shortstat(line), (5, 12, 3));
}

#[test]
fn parse_shortstat_handles_singular_file() {
    let line = " 1 file changed, 1 insertion(+)";
    assert_eq!(parse_shortstat(line), (1, 1, 0));
}

#[test]
fn parse_shortstat_returns_zeros_when_absent() {
    assert_eq!(parse_shortstat("no stat here"), (0, 0, 0));
}

#[test]
fn status_label_for_known_chars() {
    assert_eq!(status_label_for('A'), "Added");
    assert_eq!(status_label_for('M'), "Modified");
    assert_eq!(status_label_for('D'), "Deleted");
    assert_eq!(status_label_for('R'), "Renamed");
    assert_eq!(status_label_for('C'), "Copied");
}

#[test]
fn status_label_for_unknown_falls_back() {
    assert_eq!(status_label_for('X'), "Status X");
}

#[test]
fn looks_like_no_head_recognizes_phrases() {
    let mk = |s: &str| GitOutput {
        stdout: Vec::new(),
        stderr: s.as_bytes().to_vec(),
        exit_code: Some(128),
        timed_out: false,
        truncated: false,
    };
    assert!(looks_like_no_head(&mk(
        "fatal: ambiguous argument 'HEAD': unknown revision"
    )));
    assert!(looks_like_no_head(&mk(
        "fatal: your current branch 'main' does not have any commits yet"
    )));
    assert!(!looks_like_no_head(&mk("fatal: pathspec did not match")));
}
