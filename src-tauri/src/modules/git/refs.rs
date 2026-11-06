//! Pure validation and naming for refs, revisions, task ids and slugs. These
//! are the cheap, conservative pre-filters that run before anything reaches a
//! git argument list; `git check-ref-format` stays the authority for branch
//! names (see `plumbing::check_branch_name`).

pub const CHECKPOINT_PREFIX: &str = "refs/terax/checkpoints/";
const MAX_REF_BYTES: usize = 255;

/// Characters git forbids anywhere in a ref name, plus whitespace and control
/// characters, which no legitimate name needs and which would corrupt line
/// oriented plumbing output.
fn is_forbidden_ref_char(c: char) -> bool {
    c.is_control() || c.is_whitespace() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
}

/// A necessary condition for a valid branch or ref name. A name that passes is
/// still checked by git; one that fails never reaches it.
pub fn is_plausible_ref_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_REF_BYTES || name == "@" {
        return false;
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') || name.ends_with('.')
    {
        return false;
    }
    if name.contains("..") || name.contains("@{") || name.contains("//") {
        return false;
    }
    if name.chars().any(is_forbidden_ref_char) {
        return false;
    }
    name.split('/')
        .all(|part| !part.starts_with('.') && !part.ends_with(".lock"))
}

/// A revision expression safe to hand to `git rev-parse` as a single argument:
/// never an option, never multi-line. What it resolves to is decided by git.
pub fn is_safe_rev(rev: &str) -> bool {
    !rev.is_empty()
        && rev.len() <= MAX_REF_BYTES
        && !rev.starts_with('-')
        && !rev.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Task ids become a path component of a ref, so they are held to a strict
/// alphabet.
pub fn is_valid_task_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    id.len() <= 64
        && first.is_ascii_alphanumeric()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !id.contains("..")
        && !id.ends_with('.')
        && !id.ends_with(".lock")
}

pub fn checkpoint_ref(task_id: &str, turn: u32) -> String {
    format!("{CHECKPOINT_PREFIX}{task_id}/{turn}")
}

pub fn checkpoint_task_prefix(task_id: &str) -> String {
    format!("{CHECKPOINT_PREFIX}{task_id}/")
}

/// `(task id, turn)` of a checkpoint ref, or `None` for anything else.
pub fn parse_checkpoint_ref(name: &str) -> Option<(&str, u32)> {
    let rest = name.strip_prefix(CHECKPOINT_PREFIX)?;
    let (task, turn) = rest.split_once('/')?;
    if !is_valid_task_id(task) || turn.is_empty() || turn.len() > 10 {
        return None;
    }
    if !turn.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((task, turn.parse().ok()?))
}

/// The ref a restore saves the pre-restore working tree under.
pub fn prerestore_ref(task_id: &str, millis: u64) -> String {
    format!("{CHECKPOINT_PREFIX}{task_id}/prerestore-{millis}")
}

/// `(task id, millis)` of a pre-restore safety ref.
pub fn parse_prerestore_ref(name: &str) -> Option<(&str, u64)> {
    let rest = name.strip_prefix(CHECKPOINT_PREFIX)?;
    let (task, tail) = rest.split_once('/')?;
    let millis = tail.strip_prefix("prerestore-")?;
    if !is_valid_task_id(task) || millis.is_empty() || millis.len() > 20 {
        return None;
    }
    if !millis.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((task, millis.parse().ok()?))
}

/// The task a ref names when it is something a restore may start from: a turn
/// checkpoint or a pre-restore safety snapshot.
pub fn parse_restore_source(name: &str) -> Option<&str> {
    parse_checkpoint_ref(name)
        .map(|(task, _)| task)
        .or_else(|| parse_prerestore_ref(name).map(|(task, _)| task))
}

/// Lowercase `[a-z0-9._-]` slug of at most `max` characters, never empty and
/// never starting with a dot or dash.
pub fn slugify(input: &str, max: usize) -> String {
    let mut out = String::with_capacity(input.len().min(max));
    let mut last_dash = true;
    for c in input.chars() {
        let mapped = if c.is_ascii_alphanumeric() {
            Some(c.to_ascii_lowercase())
        } else if matches!(c, '.' | '_') && !out.is_empty() {
            Some(c)
        } else {
            None
        };
        match mapped {
            Some(c) => {
                out.push(c);
                last_dash = false;
            }
            None if !last_dash => {
                out.push('-');
                last_dash = true;
            }
            None => {}
        }
        if out.len() >= max {
            break;
        }
    }
    let trimmed = out.trim_matches(|c| matches!(c, '-' | '.' | '_'));
    if trimmed.is_empty() {
        "task".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plausible_ref_names() {
        for ok in [
            "main",
            "feature/x",
            "fix-1_2.3",
            "release/v1.0",
            "a/b/c",
            "caf\u{e9}",
        ] {
            assert!(is_plausible_ref_name(ok), "{ok}");
        }
        for bad in [
            "",
            "@",
            "-rf",
            "--force",
            "a..b",
            "a b",
            "a\tb",
            "a\nb",
            "a~1",
            "a^",
            "a:b",
            "a?",
            "a*",
            "a[0]",
            "a\\b",
            "/lead",
            "trail/",
            "dot.",
            "a//b",
            "a@{u}",
            ".hidden",
            "a/.hidden",
            "x.lock",
            "a/x.lock/b",
        ] {
            assert!(!is_plausible_ref_name(bad), "{bad:?}");
        }
        assert!(!is_plausible_ref_name(&"a".repeat(256)));
    }

    #[test]
    fn safe_revs() {
        for ok in [
            "HEAD",
            "main",
            "origin/main",
            "HEAD~3",
            "v1.0^{commit}",
            "abc123",
            "@{u}",
        ] {
            assert!(is_safe_rev(ok), "{ok}");
        }
        for bad in ["", "-x", "--output=/etc/passwd", "a b", "a\nb", "a\0b"] {
            assert!(!is_safe_rev(bad), "{bad:?}");
        }
    }

    #[test]
    fn task_ids() {
        for ok in ["t1", "task-42", "A.b_c", "0abc"] {
            assert!(is_valid_task_id(ok), "{ok}");
        }
        for bad in [
            "",
            ".x",
            "-x",
            "a/b",
            "a..b",
            "a b",
            "x.lock",
            "x.",
            "a\0",
            &"a".repeat(65),
        ] {
            assert!(!is_valid_task_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn checkpoint_refs_round_trip() {
        let name = checkpoint_ref("task-1", 7);
        assert_eq!(name, "refs/terax/checkpoints/task-1/7");
        assert_eq!(parse_checkpoint_ref(&name), Some(("task-1", 7)));
        assert_eq!(
            checkpoint_task_prefix("task-1"),
            "refs/terax/checkpoints/task-1/"
        );
    }

    #[test]
    fn foreign_or_malformed_checkpoint_refs_do_not_parse() {
        for bad in [
            "refs/heads/main",
            "refs/terax/checkpoints/",
            "refs/terax/checkpoints/task",
            "refs/terax/checkpoints/task/",
            "refs/terax/checkpoints/task/x",
            "refs/terax/checkpoints/task/-1",
            "refs/terax/checkpoints/../7",
            "refs/terax/checkpoints/a/b/7",
            "refs/terax/checkpoints/task/99999999999",
        ] {
            assert_eq!(parse_checkpoint_ref(bad), None, "{bad}");
        }
    }

    #[test]
    fn slugs_are_safe_and_bounded() {
        assert_eq!(slugify("Fix Login Bug!", 48), "fix-login-bug");
        assert_eq!(slugify("  --weird__name..  ", 48), "weird__name");
        assert_eq!(slugify("../../etc/passwd", 48), "etc-passwd");
        assert_eq!(slugify("", 48), "task");
        assert_eq!(slugify("!!!", 48), "task");
        assert_eq!(slugify("\u{4f60}\u{597d}", 48), "task");
        assert_eq!(slugify(&"a".repeat(100), 10), "aaaaaaaaaa");
        let slug = slugify("A/B\\C:D", 48);
        assert!(slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')));
    }
}
