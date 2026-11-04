//! Surgical edits of JSON settings files that agents also read: comments,
//! key order, indentation and every untouched byte survive, so a user's
//! hand-edited config is never reformatted by an install.

use serde_json::{Map, Value};

const MAX_DEPTH: usize = 48;

#[derive(Debug)]
struct Node {
    start: usize,
    end: usize,
    kind: Kind,
}

#[derive(Debug)]
enum Kind {
    Object(Vec<Member>),
    Array(Vec<Node>),
    Str(String),
    Other,
}

#[derive(Debug)]
struct Member {
    key: String,
    start: usize,
    value: Node,
}

impl Node {
    fn value(&self, text: &str) -> Value {
        match &self.kind {
            Kind::Object(members) => Value::Object(
                members
                    .iter()
                    .map(|member| (member.key.clone(), member.value.value(text)))
                    .collect::<Map<_, _>>(),
            ),
            Kind::Array(items) => Value::Array(items.iter().map(|item| item.value(text)).collect()),
            Kind::Str(string) => Value::String(string.clone()),
            Kind::Other => serde_json::from_str(&text[self.start..self.end]).unwrap_or(Value::Null),
        }
    }
}

struct Parser<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

/// Parses JSON with comments and trailing commas, keeping byte spans.
fn parse(text: &str) -> Result<Node, String> {
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: 0,
    };
    if text.starts_with('\u{feff}') {
        parser.pos = '\u{feff}'.len_utf8();
    }
    parser.skip_trivia()?;
    let root = parser.value(0)?;
    parser.skip_trivia()?;
    if parser.pos != parser.bytes.len() {
        return Err(parser.error("unexpected content after the top-level value"));
    }
    Ok(root)
}

impl Parser<'_> {
    fn error(&self, message: &str) -> String {
        let line = self.bytes[..self.pos.min(self.bytes.len())]
            .iter()
            .filter(|byte| **byte == b'\n')
            .count()
            + 1;
        format!("{message} (line {line})")
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_trivia(&mut self) -> Result<(), String> {
        loop {
            match self.peek() {
                Some(b' ' | b'\t' | b'\n' | b'\r') => self.pos += 1,
                Some(b'/') => match self.bytes.get(self.pos + 1) {
                    Some(b'/') => {
                        while self.peek().is_some_and(|byte| byte != b'\n') {
                            self.pos += 1;
                        }
                    }
                    Some(b'*') => {
                        let close = self.text[self.pos + 2..]
                            .find("*/")
                            .ok_or_else(|| self.error("unterminated comment"))?;
                        self.pos += 2 + close + 2;
                    }
                    _ => return Err(self.error("unexpected '/'")),
                },
                _ => return Ok(()),
            }
        }
    }

    fn value(&mut self, depth: usize) -> Result<Node, String> {
        if depth > MAX_DEPTH {
            return Err(self.error("nesting is too deep"));
        }
        let start = self.pos;
        let kind = match self.peek() {
            Some(b'{') => self.object(depth)?,
            Some(b'[') => self.array(depth)?,
            Some(b'"') => Kind::Str(self.string()?),
            Some(_) => {
                while self
                    .peek()
                    .is_some_and(|byte| !b",}] \t\r\n/".contains(&byte))
                {
                    self.pos += 1;
                }
                if self.pos == start
                    || serde_json::from_str::<Value>(&self.text[start..self.pos]).is_err()
                {
                    return Err(self.error("invalid value"));
                }
                Kind::Other
            }
            None => return Err(self.error("unexpected end of input")),
        };
        Ok(Node {
            start,
            end: self.pos,
            kind,
        })
    }

    fn string(&mut self) -> Result<String, String> {
        let start = self.pos;
        self.pos += 1;
        loop {
            match self.peek() {
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                Some(b'\\') => self.pos += 2,
                Some(b'\n') | None => return Err(self.error("unterminated string")),
                Some(_) => self.pos += 1,
            }
        }
        serde_json::from_str(&self.text[start..self.pos])
            .map_err(|_| self.error("invalid string escape"))
    }

    fn object(&mut self, depth: usize) -> Result<Kind, String> {
        self.pos += 1;
        let mut members = Vec::new();
        loop {
            self.skip_trivia()?;
            match self.peek() {
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Kind::Object(members));
                }
                Some(b'"') => {}
                _ => return Err(self.error("expected a key or '}'")),
            }
            let start = self.pos;
            let key = self.string()?;
            self.skip_trivia()?;
            if self.peek() != Some(b':') {
                return Err(self.error("expected ':'"));
            }
            self.pos += 1;
            self.skip_trivia()?;
            let value = self.value(depth + 1)?;
            members.push(Member { key, start, value });
            self.separator(b'}')?;
        }
    }

    fn array(&mut self, depth: usize) -> Result<Kind, String> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_trivia()?;
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(Kind::Array(items));
            }
            items.push(self.value(depth + 1)?);
            self.separator(b']')?;
        }
    }

    /// After an item: a comma, or the closing bracket left for the caller.
    fn separator(&mut self, close: u8) -> Result<(), String> {
        self.skip_trivia()?;
        match self.peek() {
            Some(b',') => {
                self.pos += 1;
                Ok(())
            }
            Some(byte) if byte == close => Ok(()),
            _ => Err(self.error("expected ',' or a closing bracket")),
        }
    }
}

struct Edit {
    start: usize,
    end: usize,
    text: String,
}

fn apply(text: &str, edit: Edit) -> String {
    let mut out = String::with_capacity(text.len() + edit.text.len());
    out.push_str(&text[..edit.start]);
    out.push_str(&edit.text);
    out.push_str(&text[edit.end..]);
    out
}

struct Layout {
    unit: String,
    eol: &'static str,
}

fn layout(text: &str, root: &Node) -> Layout {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let unit = match &root.kind {
        Kind::Object(members) => members
            .first()
            .filter(|member| on_own_line(text, member.start))
            .map(|member| line_indent(text, member.start).to_string())
            .filter(|indent| !indent.is_empty()),
        _ => None,
    };
    Layout {
        unit: unit.unwrap_or_else(|| "  ".to_string()),
        eol,
    }
}

fn line_start(text: &str, pos: usize) -> usize {
    text[..pos].rfind('\n').map_or(0, |index| index + 1)
}

fn on_own_line(text: &str, pos: usize) -> bool {
    text[line_start(text, pos)..pos].trim().is_empty()
}

fn line_indent(text: &str, pos: usize) -> &str {
    let start = line_start(text, pos);
    let line = &text[start..];
    let width = line
        .bytes()
        .take_while(|byte| *byte == b' ' || *byte == b'\t')
        .count();
    &line[..width]
}

/// Pretty JSON for `value`, continuation lines indented from `base`.
fn render(value: &Value, base: &str, layout: &Layout) -> String {
    let pretty = serde_json::to_string_pretty(value).unwrap_or_default();
    let mut lines = pretty.lines();
    let mut out = String::new();
    if let Some(first) = lines.next() {
        out.push_str(first);
    }
    for line in lines {
        out.push_str(layout.eol);
        let trimmed = line.trim_start_matches(' ');
        let depth = (line.len() - trimmed.len()) / 2;
        out.push_str(base);
        for _ in 0..depth {
            out.push_str(&layout.unit);
        }
        out.push_str(trimmed);
    }
    out
}

struct Container<'a> {
    open: usize,
    close: usize,
    spans: Vec<(usize, usize)>,
    text: &'a str,
}

impl Container<'_> {
    fn of_object<'a>(text: &'a str, node: &Node, members: &[Member]) -> Container<'a> {
        Container {
            open: node.start,
            close: node.end - 1,
            spans: members
                .iter()
                .map(|member| (member.start, member.value.end))
                .collect(),
            text,
        }
    }

    fn of_array<'a>(text: &'a str, node: &Node, items: &[Node]) -> Container<'a> {
        Container {
            open: node.start,
            close: node.end - 1,
            spans: items.iter().map(|item| (item.start, item.end)).collect(),
            text,
        }
    }

    fn insert(&self, item: impl Fn(&str) -> String, layout: &Layout) -> Edit {
        let text = self.text;
        let container_indent = line_indent(text, self.open);
        match self.spans.last() {
            Some(&(start, end)) if on_own_line(text, start) => {
                let indent = line_indent(text, start);
                Edit {
                    start: end,
                    end,
                    text: format!(",{}{indent}{}", layout.eol, item(indent)),
                }
            }
            Some(&(_, end)) => Edit {
                start: end,
                end,
                text: format!(", {}", item("")),
            },
            None => {
                let indent = format!("{container_indent}{}", layout.unit);
                let body = format!(
                    "{eol}{indent}{}{eol}{container_indent}",
                    item(&indent),
                    eol = layout.eol
                );
                let interior_blank = text[self.open + 1..self.close].trim().is_empty();
                Edit {
                    start: self.open + 1,
                    end: if interior_blank { self.close } else { self.open + 1 },
                    text: body,
                }
            }
        }
    }

    fn remove(&self, index: usize) -> Edit {
        let text = self.text;
        let (start, end) = self.spans[index];
        let count = self.spans.len();
        if count == 1 {
            let outside = format!(
                "{}{}",
                &text[self.open + 1..start],
                &text[end..self.close]
            );
            if outside.chars().all(|c| c.is_whitespace() || c == ',') {
                return Edit {
                    start: self.open + 1,
                    end: self.close,
                    text: String::new(),
                };
            }
        }
        if index + 1 < count || count == 1 {
            let comma = comma_after(text, end);
            let mut stop = comma.map_or(end, |comma| comma + 1);
            let mut from = start;
            if on_own_line(text, start) {
                from = line_start(text, start);
                let bytes = text.as_bytes();
                while matches!(bytes.get(stop), Some(b' ' | b'\t')) {
                    stop += 1;
                }
                if text[stop..].starts_with("\r\n") {
                    stop += 2;
                } else if text[stop..].starts_with('\n') {
                    stop += 1;
                }
            } else {
                while text.as_bytes().get(stop) == Some(&b' ') {
                    stop += 1;
                }
            }
            return Edit {
                start: from,
                end: stop,
                text: String::new(),
            };
        }
        Edit {
            start: self.spans[index - 1].1,
            end,
            text: String::new(),
        }
    }
}

/// Position of the comma following a value, skipping trivia.
fn comma_after(text: &str, from: usize) -> Option<usize> {
    let mut parser = Parser {
        text,
        bytes: text.as_bytes(),
        pos: from,
    };
    parser.skip_trivia().ok()?;
    (parser.peek() == Some(b',')).then_some(parser.pos)
}

fn find<'a>(members: &'a [Member], key: &str) -> Option<&'a Member> {
    members.iter().find(|member| member.key == key)
}

fn nested(path: &[&str], leaf: Value) -> Value {
    path.iter().rev().fold(leaf, |inner, key| {
        let mut map = Map::new();
        map.insert((*key).to_string(), inner);
        Value::Object(map)
    })
}

/// Walks `path` through objects. `Ok(Err(i))` means the key at depth `i` is
/// missing, with the object that should hold it.
fn walk<'a>(root: &'a Node, path: &[&str]) -> Result<Walk<'a>, String> {
    let mut current = root;
    for (depth, key) in path.iter().enumerate() {
        let Kind::Object(members) = &current.kind else {
            let at = if depth == 0 {
                "the top level".to_string()
            } else {
                format!("\"{}\"", path[depth - 1])
            };
            return Err(format!("{at} is not an object; refusing to edit"));
        };
        match find(members, key) {
            Some(member) => current = &member.value,
            None => {
                return Ok(Walk::Missing {
                    depth,
                    object: current,
                    members,
                });
            }
        }
    }
    Ok(Walk::Found(current))
}

enum Walk<'a> {
    Found(&'a Node),
    Missing {
        depth: usize,
        object: &'a Node,
        members: &'a [Member],
    },
}

fn array_items<'a>(node: &'a Node, path: &[&str]) -> Result<&'a [Node], String> {
    match &node.kind {
        Kind::Array(items) => Ok(items),
        _ => Err(format!(
            "\"{}\" is not an array; refusing to edit",
            path.last().copied().unwrap_or("value")
        )),
    }
}

/// Ensures the array at `path` holds exactly one element that `is_ours`
/// accepts, equal to `element`: replaced in place when it changed, appended
/// when absent, and extra copies removed. Returns the text unchanged when
/// already current.
pub fn upsert(
    text: &str,
    path: &[&str],
    element: &Value,
    is_ours: &dyn Fn(&Value) -> bool,
) -> Result<String, String> {
    let root = parse(text)?;
    let layout = layout(text, &root);
    match walk(&root, path)? {
        Walk::Missing {
            depth,
            object,
            members,
        } => {
            let value = nested(&path[depth + 1..], Value::Array(vec![element.clone()]));
            let key = serde_json::to_string(path[depth]).unwrap_or_default();
            let container = Container::of_object(text, object, members);
            let edit = container.insert(
                |indent| format!("{key}: {}", render(&value, indent, &layout)),
                &layout,
            );
            Ok(apply(text, edit))
        }
        Walk::Found(node) => {
            let items = array_items(node, path)?;
            let ours: Vec<usize> = items
                .iter()
                .enumerate()
                .filter(|(_, item)| is_ours(&item.value(text)))
                .map(|(index, _)| index)
                .collect();
            let container = Container::of_array(text, node, items);
            match ours.as_slice() {
                [] => Ok(apply(
                    text,
                    container.insert(|indent| render(element, indent, &layout), &layout),
                )),
                [only] if items[*only].value(text) == *element => Ok(text.to_string()),
                [first, extra @ ..] => {
                    let target = &items[*first];
                    let indent = line_indent(text, target.start);
                    let mut out = apply(
                        text,
                        Edit {
                            start: target.start,
                            end: target.end,
                            text: render(element, indent, &layout),
                        },
                    );
                    for index in extra.iter().rev() {
                        out = remove_item(&out, path, *index)?;
                    }
                    Ok(out)
                }
            }
        }
    }
}

fn remove_item(text: &str, path: &[&str], index: usize) -> Result<String, String> {
    let root = parse(text)?;
    let Walk::Found(node) = walk(&root, path)? else {
        return Ok(text.to_string());
    };
    let items = array_items(node, path)?;
    Ok(apply(text, Container::of_array(text, node, items).remove(index)))
}

/// Removes every element of the array at `path` that `is_ours` accepts, then
/// the array and its parent objects if that left them empty.
pub fn remove_matching(
    text: &str,
    path: &[&str],
    is_ours: &dyn Fn(&Value) -> bool,
) -> Result<String, String> {
    let mut out = text.to_string();
    loop {
        let root = parse(&out)?;
        let Walk::Found(node) = walk(&root, path)? else {
            return Ok(out);
        };
        let items = array_items(node, path)?;
        let Some(index) = items.iter().position(|item| is_ours(&item.value(&out))) else {
            break;
        };
        out = apply(&out, Container::of_array(&out, node, items).remove(index));
    }
    prune_empty(out, path)
}

fn prune_empty(mut text: String, path: &[&str]) -> Result<String, String> {
    for depth in (1..=path.len()).rev() {
        let root = parse(&text)?;
        let parent_path = &path[..depth - 1];
        let Walk::Found(array_or_object) = walk(&root, &path[..depth])? else {
            return Ok(text);
        };
        let empty = match &array_or_object.kind {
            Kind::Array(items) => items.is_empty(),
            Kind::Object(members) => members.is_empty(),
            _ => false,
        };
        if !empty {
            break;
        }
        let Walk::Found(parent) = walk(&root, parent_path)? else {
            break;
        };
        let Kind::Object(members) = &parent.kind else {
            break;
        };
        let Some(index) = members.iter().position(|member| member.key == path[depth - 1]) else {
            break;
        };
        text = apply(&text, Container::of_object(&text, parent, members).remove(index));
    }
    Ok(text)
}

/// The array at `path`, when present and an array, as plain values.
pub fn array_at(text: &str, path: &[&str]) -> Option<Vec<Value>> {
    let root = parse(text).ok()?;
    let Walk::Found(node) = walk(&root, path).ok()? else {
        return None;
    };
    let items = array_items(node, path).ok()?;
    Some(items.iter().map(|item| item.value(text)).collect())
}

/// Whether `text` is acceptable as the top-level object we can edit.
pub fn validate(text: &str) -> Result<(), String> {
    match parse(text)?.kind {
        Kind::Object(_) => Ok(()),
        _ => Err("the top-level value is not an object".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ours(value: &Value) -> bool {
        value["id"] == "ours"
    }

    fn element(version: u32) -> Value {
        json!({ "id": "ours", "version": version })
    }

    fn upsert_ours(text: &str, version: u32) -> String {
        upsert(text, &["hooks", "Stop"], &element(version), &ours).unwrap()
    }

    fn assert_valid(text: &str) -> Value {
        parse(text).unwrap().value(text)
    }

    #[test]
    fn parsing_keeps_spans_and_tolerates_jsonc() {
        let text = "// head\n{\n  /* c */ \"a\": [1, 2,], \"b\": {\"c\": \"d\\n\"},\n}\n";
        let value = assert_valid(text);
        assert_eq!(value, json!({ "a": [1, 2], "b": { "c": "d\n" } }));
        assert!(parse("\u{feff}{}").is_ok());
        for bad in ["{", "{\"a\"}", "{\"a\": }", "[1 2]", "{} x", "{\"a\": tru}", "/ {}", "{\"a\": \"x}"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        assert!(parse(&"[".repeat(100)).is_err());
    }

    #[test]
    fn an_empty_document_gets_a_complete_pretty_file() {
        let out = upsert_ours("{}", 1);
        assert_eq!(
            out,
            "{\n  \"hooks\": {\n    \"Stop\": [\n      {\n        \"id\": \"ours\",\n        \"version\": 1\n      }\n    ]\n  }\n}"
        );
        assert_eq!(assert_valid(&out)["hooks"]["Stop"][0]["version"], 1);
    }

    #[test]
    fn unrelated_content_is_preserved_byte_for_byte() {
        let text = "{\n    // keep me\n    \"model\": \"opus\",\n    \"permissions\": { \"allow\": [\"Bash\"] },\n    \"hooks\": {\n        \"Notification\": [ { \"id\": \"theirs\" } ]\n    }\n}\n";
        let out = upsert_ours(text, 1);
        assert!(out.contains("    // keep me\n    \"model\": \"opus\",\n    \"permissions\": { \"allow\": [\"Bash\"] },\n"));
        assert!(out.contains("\"Notification\": [ { \"id\": \"theirs\" } ]"));
        assert!(out.ends_with("}\n"));
        let value = assert_valid(&out);
        assert_eq!(value["hooks"]["Stop"][0]["id"], "ours");
        assert_eq!(value["hooks"]["Notification"][0]["id"], "theirs");
        // The detected four-space indentation is reused for the new member.
        assert!(out.contains("\n        \"Stop\": [\n"));
    }

    #[test]
    fn install_is_idempotent_and_updates_in_place() {
        let first = upsert_ours("{\"hooks\":{\"Stop\":[{\"id\":\"theirs\"}]}}", 1);
        assert_eq!(upsert_ours(&first, 1), first);
        let updated = upsert_ours(&first, 2);
        assert_ne!(updated, first);
        let value = assert_valid(&updated);
        assert_eq!(value["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(value["hooks"]["Stop"][0]["id"], "theirs");
        assert_eq!(value["hooks"]["Stop"][1]["version"], 2);
        assert_eq!(upsert_ours(&updated, 2), updated);
    }

    #[test]
    fn duplicates_collapse_into_one_in_place() {
        let text = "{\n  \"hooks\": {\n    \"Stop\": [\n      { \"id\": \"ours\", \"version\": 0 },\n      { \"id\": \"theirs\" },\n      { \"id\": \"ours\", \"version\": 0 }\n    ]\n  }\n}\n";
        let out = upsert_ours(text, 1);
        let value = assert_valid(&out);
        let stop = value["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["version"], 1);
        assert_eq!(stop[1]["id"], "theirs");
    }

    #[test]
    fn inline_and_empty_containers_stay_valid() {
        for text in [
            "{\"hooks\":{\"Stop\":[]}}",
            "{\"hooks\":{\"Stop\":[ ]}}",
            "{ \"hooks\": {} }",
            "{ \"hooks\": { \"Stop\": [ { \"id\": \"theirs\" } ] } }",
            "{\"other\":1}",
            "{\n}\n",
            "{ // only a comment\n}",
            "{\"hooks\":{\"Stop\":[ /* none */ ]}}",
        ] {
            let out = upsert_ours(text, 1);
            let value = assert_valid(&out);
            assert_eq!(value["hooks"]["Stop"].as_array().unwrap().last().unwrap()["id"], "ours", "{text}");
        }
    }

    #[test]
    fn crlf_files_stay_crlf() {
        let out = upsert_ours("{\r\n  \"a\": 1\r\n}\r\n", 1);
        assert!(!out.replace("\r\n", "").contains('\n'));
        assert_valid(&out);
    }

    #[test]
    fn tab_indentation_is_followed() {
        let out = upsert_ours("{\n\t\"a\": 1\n}\n", 1);
        assert!(out.contains("\n\t\"hooks\": {\n\t\t\"Stop\": ["));
        assert_valid(&out);
    }

    #[test]
    fn wrong_shapes_are_refused_not_replaced() {
        assert!(upsert("[]", &["hooks", "Stop"], &element(1), &ours).is_err());
        assert!(upsert("{\"hooks\":[]}", &["hooks", "Stop"], &element(1), &ours).is_err());
        assert!(upsert("{\"hooks\":{\"Stop\":{}}}", &["hooks", "Stop"], &element(1), &ours).is_err());
        assert!(upsert("{ nope", &["hooks", "Stop"], &element(1), &ours).is_err());
        assert!(validate("[]").is_err());
        assert!(validate("{}").is_ok());
    }

    #[test]
    fn removal_handles_every_position() {
        let both = |first: &str, last: &str| {
            format!("{{\n  \"hooks\": {{\n    \"Stop\": [\n      {first},\n      {{ \"id\": \"mid\" }},\n      {last}\n    ]\n  }}\n}}\n")
        };
        let ours_json = "{ \"id\": \"ours\" }";
        let theirs_json = "{ \"id\": \"theirs\" }";
        for text in [both(ours_json, theirs_json), both(theirs_json, ours_json)] {
            let out = remove_matching(&text, &["hooks", "Stop"], &ours).unwrap();
            let stop = assert_valid(&out)["hooks"]["Stop"].clone();
            assert_eq!(stop.as_array().unwrap().len(), 2, "{out}");
            assert!(!out.contains("ours"));
            assert!(out.contains("\"mid\""));
        }
        let middle = "{\"hooks\":{\"Stop\":[{\"id\":\"a\"},{\"id\":\"ours\"},{\"id\":\"b\"}]}}";
        let out = remove_matching(middle, &["hooks", "Stop"], &ours).unwrap();
        assert_eq!(out, "{\"hooks\":{\"Stop\":[{\"id\":\"a\"},{\"id\":\"b\"}]}}");
    }

    #[test]
    fn removing_the_only_element_prunes_empty_parents() {
        let installed = upsert_ours("{\n  \"model\": \"x\"\n}\n", 1);
        let out = remove_matching(&installed, &["hooks", "Stop"], &ours).unwrap();
        assert_eq!(assert_valid(&out), json!({ "model": "x" }));

        let kept = "{\"hooks\":{\"Stop\":[{\"id\":\"ours\"}],\"Notification\":[{\"id\":\"theirs\"}]}}";
        let out = remove_matching(kept, &["hooks", "Stop"], &ours).unwrap();
        assert_eq!(assert_valid(&out), json!({ "hooks": { "Notification": [{ "id": "theirs" }] } }));
    }

    #[test]
    fn install_then_uninstall_restores_the_original_bytes() {
        for original in [
            "{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"Notification\": [\n      { \"id\": \"theirs\" }\n    ]\n  }\n}\n",
            "{\n  // note\n  \"a\": 1\n}\n",
            "{\"a\":1}",
        ] {
            let installed = upsert_ours(original, 1);
            let restored = remove_matching(&installed, &["hooks", "Stop"], &ours).unwrap();
            assert_eq!(assert_valid(&restored), assert_valid(original), "{original}");
        }
        let original = "{\n  \"model\": \"opus\",\n  \"hooks\": {\n    \"Notification\": [\n      { \"id\": \"theirs\" }\n    ]\n  }\n}\n";
        let restored = remove_matching(&upsert_ours(original, 1), &["hooks", "Stop"], &ours).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn removal_without_a_match_changes_nothing() {
        let text = "{\n  \"hooks\": {\n    \"Stop\": [ { \"id\": \"theirs\" } ]\n  }\n}\n";
        assert_eq!(remove_matching(text, &["hooks", "Stop"], &ours).unwrap(), text);
        assert_eq!(remove_matching("{}", &["hooks", "Stop"], &ours).unwrap(), "{}");
    }

    #[test]
    fn comments_inside_elements_do_not_hide_them() {
        let text = "{\"hooks\":{\"Stop\":[{ /* ours */ \"id\": \"ours\" // x\n}]}}";
        assert_eq!(array_at(text, &["hooks", "Stop"]).unwrap(), vec![json!({ "id": "ours" })]);
        let out = remove_matching(text, &["hooks", "Stop"], &ours).unwrap();
        assert_eq!(assert_valid(&out), json!({}));
    }

    #[test]
    fn array_lookup_reports_absence() {
        assert_eq!(array_at("{}", &["hooks", "Stop"]), None);
        assert_eq!(array_at("{\"hooks\":{\"Stop\":3}}", &["hooks", "Stop"]), None);
        assert_eq!(array_at("not json", &["hooks"]), None);
    }
}
