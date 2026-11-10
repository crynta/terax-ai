//! Builds the patch that stages, unstages or reverts a chosen subset of a
//! file's hunks (or of the changed lines inside a hunk). Pure: the structured
//! hunks from `diff.rs` go in, patch bytes for `git apply` come out.
//!
//! The patch is always written in the direction of the diff it was selected
//! from (old -> new). To undo changes the caller passes `--reverse` to git and
//! asks for `Anchor::New`, because then the file being patched is the *new*
//! side and the positions in the patch must be positions in it.

use std::collections::BTreeSet;
use std::fmt;

use crate::modules::git::diff::{DiffHunk, DiffLine, LineKind};

/// Which side of the original diff the file being patched is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Anchor {
    /// Applying the selected changes forward: the file is in the old state.
    Old,
    /// Undoing the selected changes (`git apply --reverse`): the file is in the
    /// new state.
    New,
}

pub struct HunkPick<'a> {
    pub hunk: &'a DiffHunk,
    /// Indices into `hunk.lines` of the changed lines to take. `None` takes
    /// the whole hunk.
    pub lines: Option<&'a BTreeSet<usize>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PatchError {
    /// Nothing selected would change anything.
    Empty,
    /// A line index is out of range or points at a context line.
    BadLineSelection { hunk: String, index: usize },
    /// Partial selection inside a hunk that touches the end-of-file newline.
    NoNewlineHunk { hunk: String },
    /// Two picks refer to the same or overlapping hunks, or are out of order.
    Unordered,
}

impl fmt::Display for PatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PatchError::Empty => write!(f, "the selection contains no changes"),
            PatchError::BadLineSelection { hunk, index } => {
                write!(f, "line {index} of hunk {hunk} is not a changed line")
            }
            PatchError::NoNewlineHunk { hunk } => write!(
                f,
                "hunk {hunk} touches the end-of-file newline; select the whole hunk"
            ),
            PatchError::Unordered => write!(f, "hunks must be distinct and in file order"),
        }
    }
}

/// C-style quoting for a path inside a patch header, only where git requires it.
pub fn quote_path(path: &str) -> String {
    let needs = path
        .bytes()
        .any(|b| b == b'"' || b == b'\\' || b < 0x20 || b == 0x7f);
    if !needs {
        return path.to_string();
    }
    let mut out = String::with_capacity(path.len() + 2);
    out.push('"');
    for ch in path.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\{:03o}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn marker(kind: LineKind) -> u8 {
    match kind {
        LineKind::Context => b' ',
        LineKind::Add => b'+',
        LineKind::Remove => b'-',
    }
}

struct Rendered {
    lines: Vec<(LineKind, DiffLine)>,
    old_len: u32,
    new_len: u32,
}

/// Applies the line-selection rules. With `Anchor::Old` an unselected addition
/// is left out and an unselected removal stays as context; with `Anchor::New`
/// it is the other way round, because the unselected side already exists in
/// the file being patched.
fn render(pick: &HunkPick<'_>, anchor: Anchor) -> Result<Option<Rendered>, PatchError> {
    let hunk = pick.hunk;
    let mut lines: Vec<(LineKind, DiffLine)> = Vec::with_capacity(hunk.lines.len());

    if let Some(selected) = pick.lines {
        for &index in selected {
            match hunk.lines.get(index) {
                Some(line) if line.kind != LineKind::Context => {}
                _ => {
                    return Err(PatchError::BadLineSelection {
                        hunk: hunk.id.clone(),
                        index,
                    })
                }
            }
        }
        let partial = hunk
            .lines
            .iter()
            .enumerate()
            .any(|(i, l)| l.kind != LineKind::Context && !selected.contains(&i));
        if partial && hunk.lines.iter().any(|l| l.no_newline) {
            return Err(PatchError::NoNewlineHunk {
                hunk: hunk.id.clone(),
            });
        }
    }

    for (index, line) in hunk.lines.iter().enumerate() {
        let taken = match (pick.lines, line.kind) {
            (_, LineKind::Context) => true,
            (None, _) => true,
            (Some(selected), _) => selected.contains(&index),
        };
        let kind = match (taken, line.kind, anchor) {
            (true, kind, _) => Some(kind),
            (false, LineKind::Remove, Anchor::Old) => Some(LineKind::Context),
            (false, LineKind::Add, Anchor::New) => Some(LineKind::Context),
            (false, _, _) => None,
        };
        if let Some(kind) = kind {
            lines.push((kind, line.clone()));
        }
    }

    if !lines.iter().any(|(kind, _)| *kind != LineKind::Context) {
        return Ok(None);
    }
    let old_len = lines.iter().filter(|(k, _)| *k != LineKind::Add).count() as u32;
    let new_len = lines.iter().filter(|(k, _)| *k != LineKind::Remove).count() as u32;
    Ok(Some(Rendered {
        lines,
        old_len,
        new_len,
    }))
}

/// Git writes the line *before* the range when the range is empty.
fn start_field(first: u32, len: u32) -> u32 {
    if len == 0 {
        first.saturating_sub(1)
    } else {
        first
    }
}

fn first_line(start: u32, len: u32) -> u32 {
    if len == 0 {
        start + 1
    } else {
        start
    }
}

fn range(start: u32, len: u32) -> String {
    if len == 1 {
        start.to_string()
    } else {
        format!("{start},{len}")
    }
}

/// The patch for `picks` (in file order) against `path`. The header is written
/// from scratch rather than copied from git's: a copied one would carry mode or
/// rename lines that must not apply when only part of a file is selected.
pub fn build_patch(
    path: &str,
    picks: &[HunkPick<'_>],
    anchor: Anchor,
) -> Result<Vec<u8>, PatchError> {
    let mut last_end: Option<u32> = None;
    for pick in picks {
        let start = pick.hunk.old_start;
        if last_end.is_some_and(|end| start < end) {
            return Err(PatchError::Unordered);
        }
        last_end = Some(start + pick.hunk.old_lines);
    }

    let quoted_a = quote_path(&format!("a/{path}"));
    let quoted_b = quote_path(&format!("b/{path}"));
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(format!("diff --git {quoted_a} {quoted_b}\n").as_bytes());
    out.extend_from_slice(format!("--- {quoted_a}\n+++ {quoted_b}\n").as_bytes());

    // Net growth of the file contributed by the hunks already written; the
    // anchored side keeps the original positions, the other side is shifted.
    let mut shift: i64 = 0;
    let mut wrote_any = false;
    for pick in picks {
        let Some(rendered) = render(pick, anchor)? else {
            continue;
        };
        let hunk = pick.hunk;
        let (old_first, new_first) = match anchor {
            Anchor::Old => {
                let old_first = first_line(hunk.old_start, hunk.old_lines);
                (old_first as i64, old_first as i64 + shift)
            }
            Anchor::New => {
                let new_first = first_line(hunk.new_start, hunk.new_lines);
                (new_first as i64 - shift, new_first as i64)
            }
        };
        let old_first = old_first.max(0) as u32;
        let new_first = new_first.max(0) as u32;
        let old_field = start_field(old_first, rendered.old_len);
        let new_field = start_field(new_first, rendered.new_len);
        out.extend_from_slice(
            format!(
                "@@ -{} +{} @@\n",
                range(old_field, rendered.old_len),
                range(new_field, rendered.new_len)
            )
            .as_bytes(),
        );
        for (kind, line) in &rendered.lines {
            out.push(marker(*kind));
            out.extend_from_slice(&line.text);
            out.push(b'\n');
            if line.no_newline {
                out.extend_from_slice(b"\\ No newline at end of file\n");
            }
        }
        shift += i64::from(rendered.new_len) - i64::from(rendered.old_len);
        wrote_any = true;
    }

    if !wrote_any {
        return Err(PatchError::Empty);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::git::diff::parse_unified;

    fn hunks(patch: &str) -> Vec<DiffHunk> {
        parse_unified(patch.as_bytes()).remove(0).hunks
    }

    const TWO_HUNKS: &str = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,3 +10,4 @@\n j\n+k\n l\n m\n";

    fn pick<'a>(hunk: &'a DiffHunk, lines: Option<&'a BTreeSet<usize>>) -> HunkPick<'a> {
        HunkPick { hunk, lines }
    }

    fn text(patch: Vec<u8>) -> String {
        String::from_utf8(patch).unwrap()
    }

    #[test]
    fn whole_hunk_round_trips_the_original_body() {
        let h = hunks(TWO_HUNKS);
        let patch = text(build_patch("f", &[pick(&h[0], None)], Anchor::Old).unwrap());
        assert_eq!(
            patch,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"
        );
    }

    #[test]
    fn forward_selection_of_the_second_hunk_shifts_only_the_new_side() {
        let h = hunks(TWO_HUNKS);
        let patch = text(build_patch("f", &[pick(&h[1], None)], Anchor::Old).unwrap());
        assert!(patch.contains("@@ -10,3 +10,4 @@\n"), "{patch}");
    }

    #[test]
    fn skipping_the_first_hunk_moves_new_positions_for_forward_patches() {
        let h = hunks(
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,4 @@\n a\n+x\n+y\n b\n@@ -10,2 +12,3 @@\n j\n+k\n l\n",
        );
        let patch = text(build_patch("f", &[pick(&h[1], None)], Anchor::Old).unwrap());
        assert!(patch.contains("@@ -10,2 +10,3 @@\n"), "{patch}");
        let both =
            text(build_patch("f", &[pick(&h[0], None), pick(&h[1], None)], Anchor::Old).unwrap());
        assert!(both.contains("@@ -10,2 +12,3 @@\n"), "{both}");
    }

    #[test]
    fn skipping_the_first_hunk_moves_old_positions_for_reverse_patches() {
        let h = hunks(
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,4 @@\n a\n+x\n+y\n b\n@@ -10,2 +12,3 @@\n j\n+k\n l\n",
        );
        let only_second = text(build_patch("f", &[pick(&h[1], None)], Anchor::New).unwrap());
        assert!(only_second.contains("@@ -12,2 +12,3 @@\n"), "{only_second}");
        let both =
            text(build_patch("f", &[pick(&h[0], None), pick(&h[1], None)], Anchor::New).unwrap());
        assert!(both.contains("@@ -10,2 +12,3 @@\n"), "{both}");
    }

    #[test]
    fn partial_lines_forward_keep_unselected_removals_as_context_and_drop_additions() {
        let h = hunks(
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n",
        );
        // take: -b and +B only
        let selected: BTreeSet<usize> = [1, 3].into_iter().collect();
        let patch = text(build_patch("f", &[pick(&h[0], Some(&selected))], Anchor::Old).unwrap());
        assert_eq!(
            patch,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n c\n+B\n d\n"
        );
    }

    #[test]
    fn partial_lines_reverse_keep_unselected_additions_as_context_and_drop_removals() {
        let h = hunks(
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n",
        );
        // undo: +B and -b only
        let selected: BTreeSet<usize> = [1, 3].into_iter().collect();
        let patch = text(build_patch("f", &[pick(&h[0], Some(&selected))], Anchor::New).unwrap());
        assert_eq!(
            patch,
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n C\n d\n"
        );
    }

    #[test]
    fn a_selection_of_only_context_or_nothing_is_rejected() {
        let h = hunks(TWO_HUNKS);
        let ctx: BTreeSet<usize> = [0].into_iter().collect();
        assert_eq!(
            build_patch("f", &[pick(&h[0], Some(&ctx))], Anchor::Old),
            Err(PatchError::BadLineSelection {
                hunk: h[0].id.clone(),
                index: 0
            })
        );
        let none: BTreeSet<usize> = BTreeSet::new();
        assert_eq!(
            build_patch("f", &[pick(&h[0], Some(&none))], Anchor::Old),
            Err(PatchError::Empty)
        );
        assert_eq!(build_patch("f", &[], Anchor::Old), Err(PatchError::Empty));
        let out_of_range: BTreeSet<usize> = [99].into_iter().collect();
        assert!(matches!(
            build_patch("f", &[pick(&h[0], Some(&out_of_range))], Anchor::Old),
            Err(PatchError::BadLineSelection { index: 99, .. })
        ));
    }

    #[test]
    fn partial_selection_in_a_hunk_with_a_missing_newline_is_refused_but_whole_is_fine() {
        let h = hunks(
            "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-a\n-b\n\\ No newline at end of file\n+A\n+B\n\\ No newline at end of file\n",
        );
        let selected: BTreeSet<usize> = [0, 2].into_iter().collect();
        assert!(matches!(
            build_patch("f", &[pick(&h[0], Some(&selected))], Anchor::Old),
            Err(PatchError::NoNewlineHunk { .. })
        ));
        let whole = text(build_patch("f", &[pick(&h[0], None)], Anchor::Old).unwrap());
        assert!(whole.contains("-b\n\\ No newline at end of file\n+A\n+B\n\\ No newline"));
        let all: BTreeSet<usize> = [0, 1, 2, 3].into_iter().collect();
        assert!(build_patch("f", &[pick(&h[0], Some(&all))], Anchor::Old).is_ok());
    }

    #[test]
    fn overlapping_or_unordered_picks_are_rejected() {
        let h = hunks(TWO_HUNKS);
        assert_eq!(
            build_patch("f", &[pick(&h[1], None), pick(&h[0], None)], Anchor::Old),
            Err(PatchError::Unordered)
        );
        assert_eq!(
            build_patch("f", &[pick(&h[0], None), pick(&h[0], None)], Anchor::Old),
            Err(PatchError::Unordered)
        );
    }

    #[test]
    fn pure_insertion_hunks_use_the_line_before_convention() {
        let h = hunks("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -5,0 +6,2 @@\n+a\n+b\n");
        let patch = text(build_patch("f", &[pick(&h[0], None)], Anchor::Old).unwrap());
        assert!(patch.contains("@@ -5,0 +6,2 @@\n"), "{patch}");
        let reverse = text(build_patch("f", &[pick(&h[0], None)], Anchor::New).unwrap());
        assert!(reverse.contains("@@ -5,0 +6,2 @@\n"), "{reverse}");
    }

    #[test]
    fn selecting_part_of_an_insertion_turns_the_rest_into_context_for_reverse_patches() {
        let h = hunks("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -5,0 +6,2 @@\n+a\n+b\n");
        let selected: BTreeSet<usize> = [1].into_iter().collect();
        let patch = text(build_patch("f", &[pick(&h[0], Some(&selected))], Anchor::New).unwrap());
        assert!(
            patch.contains("@@ -6,1 +6,2 @@\n a\n+b\n")
                || patch.contains("@@ -6 +6,2 @@\n a\n+b\n"),
            "{patch}"
        );
    }

    #[test]
    fn paths_are_quoted_only_when_git_requires_it() {
        assert_eq!(quote_path("plain/file.txt"), "plain/file.txt");
        assert_eq!(
            quote_path("with space/caf\u{e9}.rs"),
            "with space/caf\u{e9}.rs"
        );
        assert_eq!(quote_path("a\"b"), "\"a\\\"b\"");
        assert_eq!(quote_path("a\nb"), "\"a\\nb\"");
        assert_eq!(quote_path("a\\b"), "\"a\\\\b\"");
        assert_eq!(quote_path("a\u{1}b"), "\"a\\001b\"");
        let h = hunks(TWO_HUNKS);
        let patch = text(build_patch("we\"ird", &[pick(&h[0], None)], Anchor::Old).unwrap());
        assert!(patch.starts_with("diff --git \"a/we\\\"ird\" \"b/we\\\"ird\"\n--- \"a/we\\\"ird\"\n+++ \"b/we\\\"ird\"\n"));
    }

    #[test]
    fn non_utf8_bytes_survive_into_the_patch() {
        let h =
            parse_unified(b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-caf\xe9\n+ok\n")
                .remove(0)
                .hunks;
        let patch = build_patch("f", &[pick(&h[0], None)], Anchor::Old).unwrap();
        assert!(patch.windows(4).any(|w| w == b"caf\xe9"));
    }
}
