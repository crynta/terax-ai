//! Pure model of a git diff for the review view: unified-patch parsing into
//! hunks, `--raw --numstat -z` parsing into per-file summaries, stable hunk ids
//! and line counting. No I/O; everything is bytes in, structures out, so the
//! callers can be tested against real repositories and this against fixtures.

use serde::{Serialize, Serializer};

pub const BINARY_SNIFF_BYTES: usize = 8000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineKind {
    Context,
    Add,
    Remove,
}

fn serialize_lossy<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&String::from_utf8_lossy(bytes))
}

/// One line of a hunk. `text` keeps the bytes git printed (a CRLF file keeps
/// its `\r`), minus the leading marker and the line feed; it is only turned
/// into a string at the serialization boundary, so a patch rebuilt from these
/// lines is byte-exact even for files that are not UTF-8.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    #[serde(serialize_with = "serialize_lossy")]
    pub text: Vec<u8>,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    /// A "\ No newline at end of file" marker follows this line.
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    /// Content-derived and stable for a given hunk of a given diff; the apply
    /// commands re-diff and select by it, so a selection made against an older
    /// diff can never silently land on different lines.
    pub id: String,
    #[serde(serialize_with = "serialize_lossy")]
    pub header: Vec<u8>,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
    pub added: u32,
    pub removed: u32,
}

/// One file's section of a patch.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedFileDiff {
    /// Everything before the first hunk (`diff --git`, mode lines, `---`/`+++`).
    pub header: Vec<u8>,
    pub hunks: Vec<DiffHunk>,
    pub binary: bool,
    /// The input ended inside this file's last hunk; that hunk was dropped.
    pub incomplete: bool,
}

impl ParsedFileDiff {
    pub fn added(&self) -> u32 {
        self.hunks.iter().map(|h| h.added).sum()
    }

    pub fn removed(&self) -> u32 {
        self.hunks.iter().map(|h| h.removed).sum()
    }
}

struct HunkHeader {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
}

fn parse_range(token: &[u8], sigil: u8) -> Option<(u32, u32)> {
    let rest = token.strip_prefix(&[sigil])?;
    let text = std::str::from_utf8(rest).ok()?;
    match text.split_once(',') {
        Some((start, len)) => Some((start.parse().ok()?, len.parse().ok()?)),
        None => Some((text.parse().ok()?, 1)),
    }
}

fn parse_hunk_header(line: &[u8]) -> Option<HunkHeader> {
    let rest = line.strip_prefix(b"@@ ")?;
    let mut tokens = rest.split(|b| *b == b' ');
    let (old_start, old_lines) = parse_range(tokens.next()?, b'-')?;
    let (new_start, new_lines) = parse_range(tokens.next()?, b'+')?;
    (tokens.next()? == b"@@").then_some(HunkHeader {
        old_start,
        old_lines,
        new_start,
        new_lines,
    })
}

fn fnv1a(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// FNV-1a rather than `DefaultHasher`: ids cross the IPC boundary and must not
/// depend on the Rust release that built the binary.
pub fn hunk_id(hunk: &DiffHunk) -> String {
    let mut hash = FNV_OFFSET;
    fnv1a(
        &mut hash,
        format!(
            "{},{},{},{}\n",
            hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
        )
        .as_bytes(),
    );
    for line in &hunk.lines {
        let marker = match line.kind {
            LineKind::Context => b' ',
            LineKind::Add => b'+',
            LineKind::Remove => b'-',
        };
        fnv1a(&mut hash, &[marker]);
        fnv1a(&mut hash, &line.text);
        fnv1a(&mut hash, if line.no_newline { b"\\\n" } else { b"\n" });
    }
    format!("h{hash:016x}")
}

/// A digest of a whole file diff, for a cheap "has this changed" check.
pub fn fingerprint(hunks: &[DiffHunk]) -> String {
    let mut hash = FNV_OFFSET;
    for hunk in hunks {
        fnv1a(&mut hash, hunk.id.as_bytes());
    }
    format!("f{hash:016x}")
}

fn is_binary_notice(line: &[u8]) -> bool {
    (line.starts_with(b"Binary files ") && line.ends_with(b" differ"))
        || line.starts_with(b"GIT binary patch")
}

fn lines_of(input: &[u8]) -> impl Iterator<Item = (&[u8], bool)> {
    let mut rest = input;
    std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        match rest.iter().position(|b| *b == b'\n') {
            Some(at) => {
                let line = &rest[..at];
                rest = &rest[at + 1..];
                Some((line, true))
            }
            None => {
                let line = rest;
                rest = &[];
                Some((line, false))
            }
        }
    })
}

/// Parses unified diff output (one or several files). Hunk bodies are consumed
/// by the line counts in their headers, so content that looks like a header
/// (`--- x`, `@@ ...`) inside a hunk is never misread. A hunk the input ends in
/// the middle of is dropped and reported through `incomplete`.
pub fn parse_unified(input: &[u8]) -> Vec<ParsedFileDiff> {
    let mut files: Vec<ParsedFileDiff> = Vec::new();
    let mut current: Option<ParsedFileDiff> = None;
    let mut iter = lines_of(input).peekable();

    while let Some((line, terminated)) = iter.next() {
        if line.starts_with(b"diff ") {
            if let Some(done) = current.take() {
                files.push(done);
            }
            current = Some(ParsedFileDiff::default());
        }
        let file = current.get_or_insert_with(ParsedFileDiff::default);

        let Some(header) = terminated.then(|| parse_hunk_header(line)).flatten() else {
            if is_binary_notice(line) {
                file.binary = true;
            }
            if file.hunks.is_empty() {
                file.header.extend_from_slice(line);
                if terminated {
                    file.header.push(b'\n');
                }
            }
            continue;
        };

        let mut remaining_old = header.old_lines;
        let mut remaining_new = header.new_lines;
        let mut old_cursor = header.old_start;
        let mut new_cursor = header.new_start;
        let mut lines: Vec<DiffLine> = Vec::new();
        let mut complete = true;

        loop {
            let counted = remaining_old > 0 || remaining_new > 0;
            let marker_follows =
                matches!(iter.peek(), Some((next, true)) if next.first() == Some(&b'\\'));
            if !counted && !marker_follows {
                break;
            }
            let Some((body, body_terminated)) = iter.next() else {
                complete = !counted;
                break;
            };
            if !body_terminated {
                complete = false;
                break;
            }
            match body.first() {
                Some(b'\\') => {
                    if let Some(last) = lines.last_mut() {
                        last.no_newline = true;
                    }
                }
                Some(b'+') if remaining_new > 0 => {
                    lines.push(DiffLine {
                        kind: LineKind::Add,
                        text: body[1..].to_vec(),
                        old_line: None,
                        new_line: Some(new_cursor),
                        no_newline: false,
                    });
                    new_cursor += 1;
                    remaining_new -= 1;
                }
                Some(b'-') if remaining_old > 0 => {
                    lines.push(DiffLine {
                        kind: LineKind::Remove,
                        text: body[1..].to_vec(),
                        old_line: Some(old_cursor),
                        new_line: None,
                        no_newline: false,
                    });
                    old_cursor += 1;
                    remaining_old -= 1;
                }
                Some(b' ') | None if remaining_old > 0 && remaining_new > 0 => {
                    lines.push(DiffLine {
                        kind: LineKind::Context,
                        text: body.get(1..).unwrap_or_default().to_vec(),
                        old_line: Some(old_cursor),
                        new_line: Some(new_cursor),
                        no_newline: false,
                    });
                    old_cursor += 1;
                    new_cursor += 1;
                    remaining_old -= 1;
                    remaining_new -= 1;
                }
                _ => {
                    complete = false;
                    break;
                }
            }
        }

        if !complete || remaining_old > 0 || remaining_new > 0 {
            file.incomplete = true;
            continue;
        }

        let added = lines.iter().filter(|l| l.kind == LineKind::Add).count() as u32;
        let removed = lines.iter().filter(|l| l.kind == LineKind::Remove).count() as u32;
        let mut hunk = DiffHunk {
            id: String::new(),
            header: line.to_vec(),
            old_start: header.old_start,
            old_lines: header.old_lines,
            new_start: header.new_start,
            new_lines: header.new_lines,
            lines,
            added,
            removed,
        };
        hunk.id = hunk_id(&hunk);
        file.hunks.push(hunk);
    }
    if let Some(done) = current.take() {
        files.push(done);
    }
    files
}

/// A one-hunk diff that adds `content` to an empty file: what an untracked file
/// looks like to the review view. The file is cut at `max_lines`, reported as
/// `true` in the second slot, so a huge file cannot flood the IPC channel.
pub fn synthesize_added_file(content: &[u8], max_lines: usize) -> (ParsedFileDiff, bool) {
    if content.is_empty() {
        return (ParsedFileDiff::default(), false);
    }
    let mut lines: Vec<DiffLine> = Vec::new();
    let mut truncated = false;
    for (index, (text, terminated)) in lines_of(content).enumerate() {
        if index >= max_lines {
            truncated = true;
            break;
        }
        lines.push(DiffLine {
            kind: LineKind::Add,
            text: text.to_vec(),
            old_line: None,
            new_line: Some(index as u32 + 1),
            no_newline: !terminated,
        });
    }
    let count = lines.len() as u32;
    let mut hunk = DiffHunk {
        id: String::new(),
        header: format!("@@ -0,0 +1,{count} @@").into_bytes(),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: count,
        lines,
        added: count,
        removed: 0,
    };
    hunk.id = hunk_id(&hunk);
    (
        ParsedFileDiff {
            header: Vec::new(),
            hunks: vec![hunk],
            binary: false,
            incomplete: false,
        },
        truncated,
    )
}

pub fn looks_binary(content: &[u8]) -> bool {
    content[..content.len().min(BINARY_SNIFF_BYTES)].contains(&0)
}

/// Line count the way `git diff --numstat` would report an all-added file.
pub fn count_lines(content: &[u8]) -> u32 {
    let newlines = content.iter().filter(|b| **b == b'\n').count() as u32;
    match content.last() {
        None | Some(b'\n') => newlines,
        Some(_) => newlines + 1,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
    Untracked,
}

impl FileStatus {
    fn from_raw(letter: u8) -> Option<Self> {
        Some(match letter {
            b'A' => Self::Added,
            b'M' => Self::Modified,
            b'D' => Self::Deleted,
            b'R' => Self::Renamed,
            b'C' => Self::Copied,
            b'T' => Self::TypeChanged,
            b'U' => Self::Unmerged,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileSummary {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
    pub submodule: bool,
    pub symlink: bool,
    /// Line counts were not computed (untracked file over its budget).
    pub approximate: bool,
}

const MODE_SUBMODULE: &str = "160000";
const MODE_SYMLINK: &str = "120000";

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

struct RawRecord {
    status: FileStatus,
    path: String,
    old_path: Option<String>,
    submodule: bool,
    symlink: bool,
}

/// Parses `git diff --raw --numstat -z` output: the raw block (one
/// `:mode mode sha sha status` token followed by one path, or two for renames
/// and copies) comes first, then the numstat block (`added\tremoved\tpath`, or
/// `added\tremoved\t` followed by two path tokens for renames). Records are
/// matched by new path, so the order of the two blocks never matters.
pub fn parse_raw_numstat_z(input: &[u8]) -> Vec<DiffFileSummary> {
    let mut tokens = input.split(|b| *b == 0).peekable();
    let mut records: Vec<RawRecord> = Vec::new();

    while let Some(token) = tokens.peek().copied() {
        if token.first() != Some(&b':') {
            break;
        }
        tokens.next();
        let header = String::from_utf8_lossy(token);
        let mut fields = header[1..].split(' ');
        let old_mode = fields.next().unwrap_or("");
        let new_mode = fields.next().unwrap_or("");
        let status_field = header.rsplit(' ').next().unwrap_or("");
        let letter = status_field.bytes().next().unwrap_or(b'?');
        let Some(status) = FileStatus::from_raw(letter) else {
            // An unknown status still consumes one path so the stream stays aligned.
            tokens.next();
            continue;
        };
        let two_paths = matches!(status, FileStatus::Renamed | FileStatus::Copied);
        let first = tokens.next().map(text).unwrap_or_default();
        let (old_path, path) = if two_paths {
            (Some(first), tokens.next().map(text).unwrap_or_default())
        } else {
            (None, first)
        };
        records.push(RawRecord {
            status,
            path,
            old_path,
            submodule: old_mode == MODE_SUBMODULE || new_mode == MODE_SUBMODULE,
            symlink: old_mode == MODE_SYMLINK || new_mode == MODE_SYMLINK,
        });
    }

    let mut counts: std::collections::HashMap<String, (Option<u32>, Option<u32>)> =
        std::collections::HashMap::new();
    while let Some(token) = tokens.next() {
        if token.is_empty() {
            continue;
        }
        let mut cols = token.splitn(3, |b| *b == b'\t');
        let added = cols.next().unwrap_or_default();
        let removed = cols.next().unwrap_or_default();
        let inline_path = cols.next().unwrap_or_default();
        let parse = |col: &[u8]| -> Option<u32> { std::str::from_utf8(col).ok()?.parse().ok() };
        let path = if inline_path.is_empty() {
            tokens.next();
            tokens.next().map(text).unwrap_or_default()
        } else {
            text(inline_path)
        };
        counts.insert(path, (parse(added), parse(removed)));
    }

    records
        .into_iter()
        .map(|record| {
            let known = counts.get(&record.path).copied();
            let (added, removed) = known.unwrap_or((Some(0), Some(0)));
            let binary = known.is_some_and(|(a, r)| a.is_none() && r.is_none());
            DiffFileSummary {
                path: record.path,
                old_path: record.old_path,
                status: record.status,
                added: added.unwrap_or(0),
                removed: removed.unwrap_or(0),
                binary,
                submodule: record.submodule,
                symlink: record.symlink,
                approximate: known.is_none(),
            }
        })
        .collect()
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffTotals {
    pub files: u32,
    pub added: u32,
    pub removed: u32,
    pub binary: u32,
}

pub fn totals(files: &[DiffFileSummary]) -> DiffTotals {
    files.iter().fold(DiffTotals::default(), |mut acc, file| {
        acc.files += 1;
        acc.added += file.added;
        acc.removed += file.removed;
        acc.binary += u32::from(file.binary);
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/src/a.txt b/src/a.txt\nindex 1111111..2222222 100644\n--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1,3 +1,4 @@ fn demo\n one\n-two\n+TWO\n+two and a half\n three\n@@ -10 +11 @@\n-ten\n+eleven\n";

    #[test]
    fn parses_hunks_with_line_numbers_and_ids() {
        let files = parse_unified(SAMPLE.as_bytes());
        assert_eq!(files.len(), 1);
        let file = &files[0];
        assert!(!file.binary && !file.incomplete);
        assert!(file.header.starts_with(b"diff --git a/src/a.txt"));
        assert_eq!(file.hunks.len(), 2);

        let first = &file.hunks[0];
        assert_eq!(
            (
                first.old_start,
                first.old_lines,
                first.new_start,
                first.new_lines
            ),
            (1, 3, 1, 4)
        );
        assert_eq!(first.header, b"@@ -1,3 +1,4 @@ fn demo");
        assert_eq!((first.added, first.removed), (2, 1));
        let kinds: Vec<_> = first.lines.iter().map(|l| l.kind).collect();
        assert_eq!(
            kinds,
            vec![
                LineKind::Context,
                LineKind::Remove,
                LineKind::Add,
                LineKind::Add,
                LineKind::Context
            ]
        );
        assert_eq!(first.lines[1].old_line, Some(2));
        assert_eq!(first.lines[1].new_line, None);
        assert_eq!(first.lines[3].new_line, Some(3));
        assert_eq!(first.lines[4].old_line, Some(3));
        assert_eq!(first.lines[4].new_line, Some(4));

        let second = &file.hunks[1];
        assert_eq!(
            (
                second.old_start,
                second.old_lines,
                second.new_start,
                second.new_lines
            ),
            (10, 1, 11, 1)
        );
        assert_ne!(first.id, second.id);
        assert!(first.id.starts_with('h') && first.id.len() == 17);
        assert_eq!(file.added(), 3);
        assert_eq!(file.removed(), 2);
    }

    #[test]
    fn hunk_ids_are_deterministic_and_content_sensitive() {
        let a = parse_unified(SAMPLE.as_bytes());
        let b = parse_unified(SAMPLE.as_bytes());
        assert_eq!(a[0].hunks[0].id, b[0].hunks[0].id);
        assert_eq!(fingerprint(&a[0].hunks), fingerprint(&b[0].hunks));
        let changed = SAMPLE.replace("+TWO\n", "+Two\n");
        let c = parse_unified(changed.as_bytes());
        assert_ne!(a[0].hunks[0].id, c[0].hunks[0].id);
        assert_eq!(a[0].hunks[1].id, c[0].hunks[1].id);
        assert_ne!(fingerprint(&a[0].hunks), fingerprint(&c[0].hunks));
    }

    #[test]
    fn hunk_id_has_a_pinned_value() {
        // Ids cross the IPC boundary and may be stored; a change here is a
        // breaking change of the apply contract.
        let files = parse_unified(b"@@ -1 +1 @@\n-a\n+b\n");
        assert_eq!(files[0].hunks[0].id, "h70ab2a4b279ccc5a");
    }

    #[test]
    fn content_that_looks_like_headers_stays_inside_the_hunk() {
        let patch =
            "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- not a header\n+++ also not\n";
        let files = parse_unified(patch.as_bytes());
        assert_eq!(files.len(), 1);
        let hunk = &files[0].hunks[0];
        assert_eq!(hunk.lines[0].text, b"-- not a header");
        assert_eq!(hunk.lines[1].text, b"++ also not");
    }

    #[test]
    fn no_newline_markers_attach_to_the_previous_line() {
        let patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n";
        let hunk = &parse_unified(patch.as_bytes())[0].hunks[0];
        assert_eq!(hunk.lines.len(), 2);
        assert!(hunk.lines[0].no_newline);
        assert!(!hunk.lines[1].no_newline);
    }

    #[test]
    fn crlf_lines_keep_their_carriage_return() {
        let patch = b"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\r\n+b\r\n";
        let hunk = &parse_unified(patch)[0].hunks[0];
        assert_eq!(hunk.lines[0].text, b"a\r");
        assert_eq!(hunk.lines[1].text, b"b\r");
    }

    #[test]
    fn non_utf8_content_round_trips_as_bytes_and_serializes_lossily() {
        let patch = b"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-caf\xe9\n+ok\n";
        let hunk = &parse_unified(patch)[0].hunks[0];
        assert_eq!(hunk.lines[0].text, b"caf\xe9");
        let json = serde_json::to_value(&hunk.lines[0]).unwrap();
        assert_eq!(json["text"], "caf\u{fffd}");
        assert_eq!(json["kind"], "remove");
        assert_eq!(json["oldLine"], 1);
    }

    #[test]
    fn zero_length_ranges_parse() {
        let patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -5,0 +6,2 @@\n+a\n+b\n";
        let hunk = &parse_unified(patch.as_bytes())[0].hunks[0];
        assert_eq!((hunk.old_start, hunk.old_lines), (5, 0));
        assert_eq!(hunk.lines[0].new_line, Some(6));
        assert_eq!(hunk.lines[1].new_line, Some(7));
    }

    #[test]
    fn binary_files_have_no_hunks() {
        let patch = "diff --git a/img.png b/img.png\nindex 1..2 100644\nBinary files a/img.png and b/img.png differ\n";
        let files = parse_unified(patch.as_bytes());
        assert!(files[0].binary);
        assert!(files[0].hunks.is_empty());
    }

    #[test]
    fn a_truncated_hunk_is_dropped_and_flagged() {
        let whole = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -9,3 +9,3 @@\n p\n-q\n+r\n s\n";
        for cut in 1..whole.len() {
            let files = parse_unified(&whole.as_bytes()[..cut]);
            if let Some(file) = files.first() {
                for hunk in &file.hunks {
                    let old = hunk
                        .lines
                        .iter()
                        .filter(|l| l.kind != LineKind::Add)
                        .count() as u32;
                    let new = hunk
                        .lines
                        .iter()
                        .filter(|l| l.kind != LineKind::Remove)
                        .count() as u32;
                    assert_eq!((old, new), (hunk.old_lines, hunk.new_lines), "cut at {cut}");
                }
            }
        }
        let files = parse_unified(&whole.as_bytes()[..whole.len() - 4]);
        assert_eq!(files[0].hunks.len(), 1);
        assert!(files[0].incomplete);
        let complete = parse_unified(whole.as_bytes());
        assert_eq!(complete[0].hunks.len(), 2);
        assert!(!complete[0].incomplete);
    }

    #[test]
    fn several_files_split_into_sections() {
        let patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-1\n+2\ndiff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1 @@\n+hi\n";
        let files = parse_unified(patch.as_bytes());
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].hunks.len(), 1);
        assert!(files[1].header.starts_with(b"diff --git a/b b/b"));
        assert_eq!(files[1].hunks[0].lines[0].text, b"hi");
    }

    #[test]
    fn mode_only_changes_have_a_header_and_no_hunks() {
        let patch = "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
        let files = parse_unified(patch.as_bytes());
        assert_eq!(files.len(), 1);
        assert!(files[0].hunks.is_empty());
        assert!(!files[0].binary);
    }

    #[test]
    fn synthesized_added_file_numbers_lines_and_marks_a_missing_final_newline() {
        let (file, truncated) = synthesize_added_file(b"one\ntwo\nthree", 100);
        assert!(!truncated);
        let hunk = &file.hunks[0];
        assert_eq!(hunk.header, b"@@ -0,0 +1,3 @@");
        assert_eq!(hunk.lines.len(), 3);
        assert_eq!(hunk.lines[2].new_line, Some(3));
        assert!(hunk.lines[2].no_newline);
        assert!(!hunk.lines[1].no_newline);
        assert_eq!((hunk.added, hunk.removed), (3, 0));
    }

    #[test]
    fn synthesized_added_file_is_cut_at_the_line_budget() {
        let content: Vec<u8> = (0..10)
            .flat_map(|i| format!("l{i}\n").into_bytes())
            .collect();
        let (file, truncated) = synthesize_added_file(&content, 4);
        assert!(truncated);
        assert_eq!(file.hunks[0].lines.len(), 4);
        assert_eq!(file.hunks[0].new_lines, 4);
    }

    #[test]
    fn empty_added_file_has_no_hunks() {
        let (file, truncated) = synthesize_added_file(b"", 10);
        assert!(file.hunks.is_empty() && !truncated);
    }

    #[test]
    fn line_counting_matches_numstat_conventions() {
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"a"), 1);
        assert_eq!(count_lines(b"a\n"), 1);
        assert_eq!(count_lines(b"a\nb"), 2);
        assert_eq!(count_lines(b"\n\n"), 2);
    }

    #[test]
    fn binary_sniff_looks_only_at_the_leading_window() {
        assert!(looks_binary(b"ab\0cd"));
        let mut late = vec![b'a'; BINARY_SNIFF_BYTES];
        late.push(0);
        assert!(!looks_binary(&late));
        assert!(!looks_binary(b""));
    }

    fn raw(parts: &[&str]) -> Vec<u8> {
        let mut out = Vec::new();
        for part in parts {
            out.extend_from_slice(part.as_bytes());
            out.push(0);
        }
        out
    }

    #[test]
    fn parses_raw_and_numstat_blocks() {
        let input = raw(&[
            ":100644 100644 aaa bbb M",
            "src/a b.txt",
            ":000000 100644 000 ccc A",
            "new.txt",
            ":100644 000000 ddd 000 D",
            "gone.txt",
            ":100644 100644 eee fff R087",
            "old name.txt",
            "caf\u{e9}.txt",
            ":100644 100644 111 222 M",
            "img.png",
            "3\t1\tsrc/a b.txt",
            "5\t0\tnew.txt",
            "0\t4\tgone.txt",
            "2\t2\t",
            "old name.txt",
            "caf\u{e9}.txt",
            "-\t-\timg.png",
        ]);
        let files = parse_raw_numstat_z(&input);
        assert_eq!(files.len(), 5);
        assert_eq!(files[0].path, "src/a b.txt");
        assert_eq!((files[0].added, files[0].removed), (3, 1));
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!(files[1].status, FileStatus::Added);
        assert_eq!(files[2].status, FileStatus::Deleted);
        assert_eq!(files[2].removed, 4);
        assert_eq!(files[3].status, FileStatus::Renamed);
        assert_eq!(files[3].path, "caf\u{e9}.txt");
        assert_eq!(files[3].old_path.as_deref(), Some("old name.txt"));
        assert_eq!((files[3].added, files[3].removed), (2, 2));
        assert!(files[4].binary);
        assert_eq!((files[4].added, files[4].removed), (0, 0));
        assert_eq!(
            totals(&files),
            DiffTotals {
                files: 5,
                added: 10,
                removed: 7,
                binary: 1
            }
        );
    }

    #[test]
    fn a_path_that_starts_with_a_colon_is_not_mistaken_for_a_record() {
        let input = raw(&[":100644 100644 aaa bbb M", ":weird", "1\t1\t:weird"]);
        let files = parse_raw_numstat_z(&input);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, ":weird");
        assert_eq!(files[0].added, 1);
    }

    #[test]
    fn flags_submodules_symlinks_and_unmerged_entries() {
        let input = raw(&[
            ":160000 160000 aaa bbb M",
            "vendor/lib",
            ":120000 120000 ccc ddd M",
            "link",
            ":100644 100644 000 000 U",
            "conflict.txt",
            "1\t1\tvendor/lib",
            "1\t1\tlink",
            "0\t0\tconflict.txt",
        ]);
        let files = parse_raw_numstat_z(&input);
        assert!(files[0].submodule && !files[0].symlink);
        assert!(files[1].symlink && !files[1].submodule);
        assert_eq!(files[2].status, FileStatus::Unmerged);
    }

    #[test]
    fn empty_and_garbage_input_parse_to_nothing() {
        assert!(parse_raw_numstat_z(b"").is_empty());
        assert!(parse_raw_numstat_z(b"\0\0").is_empty());
    }

    #[test]
    fn summary_serializes_camel_case_status() {
        let summary = DiffFileSummary {
            path: "a".into(),
            old_path: None,
            status: FileStatus::TypeChanged,
            added: 1,
            removed: 2,
            binary: false,
            submodule: false,
            symlink: false,
            approximate: true,
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["status"], "typeChanged");
        assert_eq!(json["oldPath"], serde_json::Value::Null);
        assert_eq!(json["approximate"], true);
    }
}
