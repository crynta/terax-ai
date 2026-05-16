use crate::modules::git::types::GitChangedFile;

pub fn parse_branch_header(
    header: &str,
) -> Result<(String, Option<String>, u32, u32, bool), String> {
    if !header.starts_with("## ") {
        return Err("malformed git status branch header".into());
    }

    let body = &header[3..];
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let (head_part, upstream) = match body.split_once("...") {
        Some((head, rest)) => {
            let (upstream, meta) = match rest.split_once(' ') {
                Some((upstream, meta)) => (Some(upstream.to_string()), Some(meta)),
                None => (Some(rest.to_string()), None),
            };

            if let Some(meta) = meta {
                if let Some(start) = meta.find('[') {
                    if let Some(end) = meta[start + 1..].find(']') {
                        let status = &meta[start + 1..start + 1 + end];
                        for part in status.split(',') {
                            let part = part.trim();
                            if let Some(v) = part.strip_prefix("ahead ") {
                                ahead = v.parse::<u32>().unwrap_or(0);
                            } else if let Some(v) = part.strip_prefix("behind ") {
                                behind = v.parse::<u32>().unwrap_or(0);
                            }
                        }
                    }
                }
            }

            (head.to_string(), upstream)
        }
        None => (body.split(' ').next().unwrap_or("HEAD").to_string(), None),
    };

    let is_detached = head_part == "HEAD" || head_part.contains("(detached");
    Ok((head_part, upstream, ahead, behind, is_detached))
}

pub fn parse_changed_files(fields: &[&str]) -> Vec<GitChangedFile> {
    let mut files = Vec::new();
    let mut i = 1usize;
    while i < fields.len() {
        let entry = fields[i];
        if entry.len() < 3 {
            i += 1;
            continue;
        }

        let xy = &entry[..2];
        let path_part = &entry[3..];
        let index_status = xy.chars().next().unwrap_or(' ');
        let worktree_status = xy.chars().nth(1).unwrap_or(' ');
        let original_path = if matches!(index_status, 'R' | 'C') {
            let prev = fields.get(i + 1).map(|s| (*s).to_string());
            i += 1;
            prev
        } else {
            None
        };

        files.push(GitChangedFile {
            path: path_part.to_string(),
            original_path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            staged: is_staged(index_status, worktree_status),
            unstaged: is_unstaged(index_status, worktree_status),
            untracked: index_status == '?' && worktree_status == '?',
            status_label: status_label(index_status, worktree_status),
        });
        i += 1;
    }

    files
}

fn is_staged(index_status: char, worktree_status: char) -> bool {
    index_status != ' ' && !(index_status == '?' && worktree_status == '?')
}

fn is_unstaged(index_status: char, worktree_status: char) -> bool {
    worktree_status != ' ' || (index_status == '?' && worktree_status == '?')
}

fn status_label(index_status: char, worktree_status: char) -> String {
    match (index_status, worktree_status) {
        ('?', '?') => "Untracked".into(),
        ('A', _) => "Added".into(),
        ('M', _) | (_, 'M') => "Modified".into(),
        ('D', _) | (_, 'D') => "Deleted".into(),
        ('R', _) | (_, 'R') => "Renamed".into(),
        ('C', _) | (_, 'C') => "Copied".into(),
        ('U', _) | (_, 'U') => "Unmerged".into(),
        _ => "Changed".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_branch_header;

    #[test]
    fn parses_ahead_branch_header() {
        let (branch, upstream, ahead, behind, detached) =
            parse_branch_header("## main...origin/main [ahead 2]").unwrap();
        assert_eq!(branch, "main");
        assert_eq!(upstream.as_deref(), Some("origin/main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 0);
        assert!(!detached);
    }

    #[test]
    fn parses_behind_branch_header() {
        let (branch, upstream, ahead, behind, detached) =
            parse_branch_header("## main...origin/main [behind 3]").unwrap();
        assert_eq!(branch, "main");
        assert_eq!(upstream.as_deref(), Some("origin/main"));
        assert_eq!(ahead, 0);
        assert_eq!(behind, 3);
        assert!(!detached);
    }

    #[test]
    fn parses_diverged_branch_header() {
        let (branch, upstream, ahead, behind, detached) =
            parse_branch_header("## main...origin/main [ahead 4, behind 1]").unwrap();
        assert_eq!(branch, "main");
        assert_eq!(upstream.as_deref(), Some("origin/main"));
        assert_eq!(ahead, 4);
        assert_eq!(behind, 1);
        assert!(!detached);
    }

    #[test]
    fn parses_detached_head_header() {
        let (branch, upstream, ahead, behind, detached) =
            parse_branch_header("## HEAD (detached at 1a2b3c4)").unwrap();
        assert_eq!(branch, "HEAD");
        assert_eq!(upstream, None);
        assert_eq!(ahead, 0);
        assert_eq!(behind, 0);
        assert!(detached);
    }
}
