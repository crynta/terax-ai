// Pure parsing for shell history files. No I/O here so the formats stay
// unit-tested; ranking lives in `index.rs`. zsh metafies bytes >= 0x80 in its histfile (Meta 0x83 followed
// by byte ^ 0x20); callers demetafy raw bytes before handing us a string.

const META: u8 = 0x83;

pub fn demetafy(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == META && i + 1 < bytes.len() {
            out.push(bytes[i + 1] ^ 0x20);
            i += 2;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

// zsh writes a multi-line command as physical lines joined by a trailing
// backslash; an even count of trailing backslashes is a literal, not a join.
fn join_continuations(content: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    for line in content.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trailing = line.bytes().rev().take_while(|&b| b == b'\\').count();
        if trailing % 2 == 1 {
            cur.push_str(&line[..line.len() - 1]);
            cur.push('\n');
        } else {
            cur.push_str(line);
            lines.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

fn push_cmd(out: &mut Vec<(String, i64)>, cmd: &str, ts: i64) {
    let c = cmd.trim();
    if !c.is_empty() {
        out.push((c.to_string(), ts));
    }
}

pub fn parse_zsh(content: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    for line in join_continuations(content) {
        let line = line.trim_end_matches('\n');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix(": ") {
            if let Some(semi) = rest.find(';') {
                let ts = rest[..semi]
                    .split(':')
                    .next()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .unwrap_or(0);
                push_cmd(&mut out, &rest[semi + 1..], ts);
                continue;
            }
        }
        push_cmd(&mut out, line, 0);
    }
    out
}

pub fn parse_bash(content: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let mut ts = 0i64;
    for line in content.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if let Some(num) = line.strip_prefix('#') {
            if let Ok(t) = num.trim().parse::<i64>() {
                ts = t;
                continue;
            }
        }
        push_cmd(&mut out, line, ts);
        ts = 0;
    }
    out
}

fn unescape_fish(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn parse_fish(content: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let mut pending: Option<String> = None;
    for line in content.split('\n') {
        if let Some(cmd) = line.strip_prefix("- cmd: ") {
            if let Some(p) = pending.take() {
                push_cmd(&mut out, &p, 0);
            }
            pending = Some(unescape_fish(cmd));
        } else if let Some(when) = line.trim().strip_prefix("when: ") {
            if let Some(cmd) = pending.take() {
                let ts = when.trim().parse::<i64>().unwrap_or(0);
                push_cmd(&mut out, &cmd, ts);
            }
        }
    }
    if let Some(p) = pending.take() {
        push_cmd(&mut out, &p, 0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zsh_extended_and_plain() {
        let c = ": 1700000000:0;git status\nls -la\n: 1700000005:2;echo hi;there\n";
        let got = parse_zsh(c);
        assert_eq!(
            got,
            vec![
                ("git status".into(), 1700000000),
                ("ls -la".into(), 0),
                ("echo hi;there".into(), 1700000005),
            ]
        );
    }

    #[test]
    fn zsh_multiline_continuation() {
        let c = ": 1:0;for i in 1 2; do\\\necho $i\\\ndone\n";
        let got = parse_zsh(c);
        assert_eq!(got.len(), 1);
        assert!(got[0].0.contains("for i in 1 2"));
        assert!(got[0].0.contains("echo $i"));
    }

    #[test]
    fn bash_with_and_without_timestamps() {
        let c = "#1700000000\ngit push\nls\n";
        let got = parse_bash(c);
        assert_eq!(got, vec![("git push".into(), 1700000000), ("ls".into(), 0)]);
    }

    #[test]
    fn fish_format() {
        let c =
            "- cmd: git commit -m \\\"x\\\"\n  when: 1700000000\n- cmd: ls\n  when: 1700000001\n";
        let got = parse_fish(c);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].1, 1700000000);
        assert_eq!(got[1].0, "ls");
    }

    #[test]
    fn demetafy_restores_high_bytes() {
        // Meta(0x83) + ('e' ^ 0x20) encodes a metafied byte; here just verify xor.
        let input = [b'a', META, b'A', b'b'];
        assert_eq!(demetafy(&input), vec![b'a', b'A' ^ 0x20, b'b']);
    }
}
