const ELLIPSIS: &str = "\u{2026}";

/// Cuts `value` to at most `max` bytes on a character boundary, marking the cut.
pub fn truncate_str(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    let mut end = max;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = String::with_capacity(end + ELLIPSIS.len());
    out.push_str(&value[..end]);
    out.push_str(ELLIPSIS);
    out
}

/// Strips control characters (keeping newline and tab), trims, and bounds the
/// length. Returns `None` for text that is empty afterwards.
pub fn clean_text(value: &str, max: usize) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(truncate_str(trimmed, max))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_respects_character_boundaries() {
        assert_eq!(truncate_str("abc", 3), "abc");
        assert_eq!(truncate_str("abcd", 3), "abc\u{2026}");
        let cut = truncate_str("a\u{e9}b", 2);
        assert_eq!(cut, "a\u{2026}");
        assert_eq!(truncate_str("\u{1f600}\u{1f600}", 5), "\u{1f600}\u{2026}");
    }

    #[test]
    fn cleaning_drops_control_characters_and_empty_text() {
        assert_eq!(clean_text("  hi\u{1b}[31m there \u{7}", 64).as_deref(), Some("hi[31m there"));
        assert_eq!(clean_text("a\nb\tc", 64).as_deref(), Some("a\nb\tc"));
        assert_eq!(clean_text(" \n\u{0} ", 64), None);
        assert_eq!(clean_text("", 64), None);
        assert_eq!(clean_text("abcdef", 3).as_deref(), Some("abc\u{2026}"));
    }
}
