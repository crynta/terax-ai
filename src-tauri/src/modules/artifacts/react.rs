use serde::{Deserialize, Serialize};

use super::types::{ArtifactDiagnostic, ArtifactError, ArtifactResult};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactCompileInput {
    pub content: String,
    #[serde(default)]
    pub preview_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactCompileResult {
    pub document: String,
    pub diagnostics: Vec<ArtifactDiagnostic>,
}

const PREVIEW_TOKEN_PLACEHOLDER: &str = "__TERAX_PREVIEW_TOKEN__";
const COMPONENT_MODULE_PLACEHOLDER: &str = "__TERAX_COMPONENT_MODULE__";

pub fn compile_react_artifact(input: ReactCompileInput) -> ArtifactResult<ReactCompileResult> {
    validate_react_source(&input.content)?;
    let component = compile_component_module(&input.content)?;
    Ok(ReactCompileResult {
        document: runtime_document(&component, input.preview_token.as_deref()),
        diagnostics: Vec::new(),
    })
}

fn validate_react_source(source: &str) -> ArtifactResult<()> {
    if contains_forbidden_runtime_call(source)? {
        return Err(compile_error(
            "React artifacts may not use dynamic imports or require()",
        ));
    }

    for specifier in static_module_specifiers(source)? {
        if !matches!(specifier.as_str(), "react" | "react/jsx-runtime") {
            return Err(compile_error(format!(
                "React artifact imports are limited to the bundled React allowlist: `{specifier}` is not allowed",
            )));
        }
    }

    for forbidden in ["@tauri-apps/", "http://", "https://", "file://", "node:"] {
        if source.contains(forbidden) {
            return Err(compile_error(
                "React artifact source references a forbidden runtime capability",
            ));
        }
    }

    Ok(())
}

fn static_module_specifiers(source: &str) -> ArtifactResult<Vec<String>> {
    let mut specifiers = Vec::new();
    for statement in source.split(';') {
        let trimmed = statement.trim_start();
        if starts_with_keyword(trimmed, "import") {
            let specifier = import_specifier(trimmed).ok_or_else(|| {
                compile_error("React artifact import statements must use string specifiers")
            })?;
            specifiers.push(specifier);
        } else if is_export_from_statement(trimmed) {
            let specifier = from_specifier(trimmed).ok_or_else(|| {
                compile_error("React artifact export statements must use string specifiers")
            })?;
            specifiers.push(specifier);
        }
    }
    Ok(specifiers)
}

fn import_specifier(import_statement: &str) -> Option<String> {
    let after_import = import_statement["import".len()..].trim_start();
    quoted_string(after_import.trim_end_matches(';')).or_else(|| from_specifier(import_statement))
}

fn is_export_from_statement(statement: &str) -> bool {
    if !starts_with_keyword(statement, "export") {
        return false;
    }
    let after_export = statement["export".len()..].trim_start();
    (after_export.starts_with('{') || after_export.starts_with('*'))
        && from_specifier(statement).is_some()
}

fn from_specifier(statement: &str) -> Option<String> {
    let mut search_start = 0;
    while let Some(offset) = statement[search_start..].find("from") {
        let index = search_start + offset;
        if is_keyword_at(statement, index, "from") {
            let after_from = statement[index + "from".len()..].trim_start();
            if let Some(specifier) = quoted_string(after_from.trim_end_matches(';')) {
                return Some(specifier);
            }
        }
        search_start = index + "from".len();
    }
    None
}

fn starts_with_keyword(value: &str, keyword: &str) -> bool {
    value.starts_with(keyword) && keyword_next_boundary(value, keyword.len())
}

fn is_keyword_at(value: &str, index: usize, keyword: &str) -> bool {
    value[index..].starts_with(keyword)
        && keyword_previous_boundary(value, index)
        && keyword_next_boundary(value, index + keyword.len())
}

fn keyword_previous_boundary(value: &str, index: usize) -> bool {
    value[..index]
        .chars()
        .next_back()
        .is_none_or(|character| !is_identifier_part(character))
}

fn keyword_next_boundary(value: &str, index: usize) -> bool {
    value[index..]
        .chars()
        .next()
        .is_none_or(|character| !is_identifier_part(character))
}

fn is_identifier_part(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

fn contains_forbidden_runtime_call(source: &str) -> ArtifactResult<bool> {
    let mut position = 0;
    while position < source.len() {
        let Some(character) = source[position..].chars().next() else {
            break;
        };
        if character == '\'' || character == '"' || character == '`' {
            let (_literal, consumed) = read_js_string_like(&source[position..], character)?;
            position += consumed;
            continue;
        }
        if source[position..].starts_with("//") {
            let end = source[position..]
                .find('\n')
                .map(|offset| position + offset + 1)
                .unwrap_or(source.len());
            position = end;
            continue;
        }
        if source[position..].starts_with("/*") {
            let end = source[position + 2..]
                .find("*/")
                .map(|offset| position + offset + 4)
                .unwrap_or(source.len());
            position = end;
            continue;
        }
        if source[position..].starts_with("import(")
            || source[position..].starts_with("import (")
            || source[position..].starts_with("require(")
        {
            return Ok(true);
        }
        position += character.len_utf8();
    }
    Ok(false)
}

fn quoted_string(value: &str) -> Option<String> {
    let mut chars = value.chars();
    let quote = chars.next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let rest = chars.as_str();
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

struct CompiledReactComponent {
    module: String,
    scoped_css: String,
}

fn compile_component_module(source: &str) -> ArtifactResult<CompiledReactComponent> {
    let (source_without_css, css_blocks) = extract_exported_css(source)?;
    let stripped = strip_static_imports_and_reexports(&source_without_css);
    let (module, component_name) = normalize_default_component(&stripped)?;
    let transformed = transform_jsx_in_js(&module, source, 0)?;
    Ok(CompiledReactComponent {
        module: format!(
            "const {{useState,useReducer,useMemo,useEffect,useRef,useCallback}} = React;\n{transformed}\nreturn {component_name};"
        ),
        scoped_css: scope_css_blocks(&css_blocks),
    })
}

fn strip_static_imports_and_reexports(source: &str) -> String {
    source
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            !starts_with_keyword(trimmed, "import") && !is_export_from_statement(trimmed)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_exported_css(source: &str) -> ArtifactResult<(String, Vec<String>)> {
    let mut kept_lines = Vec::new();
    let mut css_blocks = Vec::new();
    for line in source.lines() {
        if let Some(css) = exported_css_line(line)? {
            css_blocks.push(css);
        } else {
            kept_lines.push(line);
        }
    }
    Ok((kept_lines.join("\n"), css_blocks))
}

fn exported_css_line(line: &str) -> ArtifactResult<Option<String>> {
    let trimmed = line.trim_start();
    if !starts_with_keyword(trimmed, "export") {
        return Ok(None);
    }
    let after_export = trimmed["export".len()..].trim_start();
    if !starts_with_keyword(after_export, "const") {
        return Ok(None);
    }
    let after_const = after_export["const".len()..].trim_start();
    let name = after_const
        .chars()
        .take_while(|character| is_identifier_part(*character))
        .collect::<String>();
    if name != "css" && name != "styles" {
        return Ok(None);
    }
    let after_name = after_const[name.len()..].trim_start();
    if !after_name.starts_with('=') {
        return Err(compile_error(
            "React artifact CSS exports must assign a string literal",
        ));
    }
    let after_equals = after_name[1..].trim_start();
    let Some(quote) = after_equals.chars().next() else {
        return Err(compile_error(
            "React artifact CSS exports must assign a string literal",
        ));
    };
    if quote != '\'' && quote != '"' && quote != '`' {
        return Err(compile_error(
            "React artifact CSS exports must assign a string literal",
        ));
    }
    let (literal, consumed) = read_js_string_like(after_equals, quote)?;
    if quote == '`' && literal.contains("${") {
        return Err(compile_error(
            "React artifact CSS exports may not use interpolation",
        ));
    }
    let trailing = after_equals[consumed..].trim();
    if !trailing.is_empty() && trailing != ";" {
        return Err(compile_error(
            "React artifact CSS export must end after the string literal",
        ));
    }
    Ok(Some(decode_js_string_literal(&literal)))
}

fn decode_js_string_literal(literal: &str) -> String {
    let mut chars = literal.chars();
    let Some(quote) = chars.next() else {
        return String::new();
    };
    let mut output = String::new();
    let mut escaped = false;
    for character in chars {
        if escaped {
            match character {
                'n' => output.push('\n'),
                'r' => output.push('\r'),
                't' => output.push('\t'),
                '\\' => output.push('\\'),
                '\'' => output.push('\''),
                '"' => output.push('"'),
                '`' => output.push('`'),
                other => output.push(other),
            }
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            break;
        } else {
            output.push(character);
        }
    }
    output
}

fn scope_css_blocks(css_blocks: &[String]) -> String {
    css_blocks
        .iter()
        .map(|css| scope_css(css))
        .collect::<Vec<_>>()
        .join("\n")
}

fn scope_css(css: &str) -> String {
    let mut output = String::new();
    let mut position = 0;
    while position < css.len() {
        let Some(open_brace) = find_next_css_brace(css, position) else {
            break;
        };
        let Some(close_brace) = find_matching_css_brace(css, open_brace) else {
            break;
        };
        let selectors = css[position..open_brace].trim();
        let declarations = css[open_brace + 1..close_brace].trim();
        if selectors.is_empty() {
            position = close_brace + 1;
            continue;
        }
        if selectors.starts_with('@') {
            output.push_str(&scope_css_at_rule(selectors, declarations));
        } else {
            let scoped_selectors = selectors
                .split(',')
                .map(scope_css_selector)
                .collect::<Vec<_>>()
                .join(", ");
            output.push_str(&scoped_selectors);
            output.push('{');
            output.push_str(declarations);
            output.push('}');
        }
        position = close_brace + 1;
    }
    output
}

fn scope_css_at_rule(rule: &str, declarations: &str) -> String {
    let normalized = rule.trim_start().to_ascii_lowercase();
    let scoped_body = if normalized.starts_with("@media")
        || normalized.starts_with("@supports")
        || normalized.starts_with("@container")
        || normalized.starts_with("@layer")
    {
        scope_css(declarations)
    } else {
        declarations.to_string()
    };
    format!("{rule}{{{scoped_body}}}")
}

fn find_next_css_brace(css: &str, start: usize) -> Option<usize> {
    let bytes = css.as_bytes();
    let mut position = start;
    while position < bytes.len() {
        match bytes[position] {
            b'\'' | b'"' => position = skip_css_string(css, position),
            b'/' if bytes.get(position + 1) == Some(&b'*') => {
                position = skip_css_comment(css, position)
            }
            b'{' => return Some(position),
            _ => position += 1,
        }
    }
    None
}

fn find_matching_css_brace(css: &str, open_brace: usize) -> Option<usize> {
    let bytes = css.as_bytes();
    let mut depth = 0usize;
    let mut position = open_brace;
    while position < bytes.len() {
        match bytes[position] {
            b'\'' | b'"' => position = skip_css_string(css, position),
            b'/' if bytes.get(position + 1) == Some(&b'*') => {
                position = skip_css_comment(css, position)
            }
            b'{' => {
                depth += 1;
                position += 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(position);
                }
                position += 1;
            }
            _ => position += 1,
        }
    }
    None
}

fn skip_css_string(css: &str, start: usize) -> usize {
    let bytes = css.as_bytes();
    let quote = bytes[start];
    let mut position = start + 1;
    while position < bytes.len() {
        if bytes[position] == b'\\' {
            position = (position + 2).min(bytes.len());
        } else if bytes[position] == quote {
            return position + 1;
        } else {
            position += 1;
        }
    }
    bytes.len()
}

fn skip_css_comment(css: &str, start: usize) -> usize {
    css[start + 2..]
        .find("*/")
        .map(|offset| start + offset + 4)
        .unwrap_or(css.len())
}

fn scope_css_selector(selector: &str) -> String {
    const SCOPE: &str = "[data-terax-artifact-scope=\"react-preview\"]";
    let selector = selector.trim();
    if selector == ":host" || selector == "&" {
        SCOPE.to_string()
    } else if selector.starts_with('@') {
        selector.to_string()
    } else {
        format!("{SCOPE} {selector}")
    }
}

fn normalize_default_component(source: &str) -> ArtifactResult<(String, String)> {
    if let Some(index) = source.find("export default function") {
        let after = &source[index + "export default function".len()..];
        let name = after
            .trim_start()
            .chars()
            .take_while(|character| is_identifier_part(*character))
            .collect::<String>();
        if name.is_empty() {
            let mut module = source.to_string();
            module.replace_range(
                index..index + "export default function".len(),
                "function ArtifactComponent",
            );
            return Ok((module, "ArtifactComponent".to_string()));
        }
        let mut module = source.to_string();
        module.replace_range(index..index + "export default ".len(), "");
        return Ok((module, name));
    }

    if let Some(index) = source.find("function") {
        let after = &source[index + "function".len()..];
        let name = after
            .trim_start()
            .chars()
            .take_while(|character| is_identifier_part(*character))
            .collect::<String>();
        if !name.is_empty() {
            return Ok((source.to_string(), name));
        }
    }

    Err(compile_error(
        "React artifact must export a default function component",
    ))
}

fn transform_jsx_in_js(
    input: &str,
    full_source: &str,
    base_offset: usize,
) -> ArtifactResult<String> {
    let mut output = String::new();
    let mut position = 0;
    while position < input.len() {
        let Some(character) = input[position..].chars().next() else {
            break;
        };
        if character == '\'' || character == '"' || character == '`' {
            let (literal, consumed) = read_js_string_like(&input[position..], character)?;
            output.push_str(&literal);
            position += consumed;
            continue;
        }
        if input[position..].starts_with("//") {
            let end = input[position..]
                .find('\n')
                .map(|offset| position + offset + 1)
                .unwrap_or(input.len());
            output.push_str(&input[position..end]);
            position = end;
            continue;
        }
        if input[position..].starts_with("/*") {
            let end = input[position + 2..]
                .find("*/")
                .map(|offset| position + 2 + offset + 2)
                .ok_or_else(|| {
                    diagnostic_error(
                        full_source,
                        base_offset + position,
                        "JavaScript comment was not closed",
                    )
                })?;
            output.push_str(&input[position..end]);
            position = end;
            continue;
        }
        if character == '<' && looks_like_jsx_start(&input[position..]) {
            let mut parser =
                RuntimeJsxParser::new(&input[position..], full_source, base_offset + position);
            let expression = parser.parse_node()?;
            output.push_str(&expression);
            position += parser.position;
            continue;
        }
        output.push(character);
        position += character.len_utf8();
    }
    Ok(output)
}

fn looks_like_jsx_start(value: &str) -> bool {
    matches!(value.chars().nth(1), Some('>' | 'A'..='Z' | 'a'..='z'))
}

fn read_js_string_like(input: &str, quote: char) -> ArtifactResult<(String, usize)> {
    let mut position = quote.len_utf8();
    while position < input.len() {
        let Some(character) = input[position..].chars().next() else {
            break;
        };
        position += character.len_utf8();
        if character == '\\' {
            if let Some(next) = input[position..].chars().next() {
                position += next.len_utf8();
            }
            continue;
        }
        if character == quote {
            return Ok((input[..position].to_string(), position));
        }
    }
    Err(compile_error("JavaScript string literal was not closed"))
}

struct RuntimeJsxParser<'a> {
    input: &'a str,
    full_source: &'a str,
    base_offset: usize,
    position: usize,
}

impl<'a> RuntimeJsxParser<'a> {
    fn new(input: &'a str, full_source: &'a str, base_offset: usize) -> Self {
        Self {
            input,
            full_source,
            base_offset,
            position: 0,
        }
    }

    fn parse_node(&mut self) -> ArtifactResult<String> {
        if self.starts_with("<>") {
            self.parse_fragment()
        } else {
            self.parse_element()
        }
    }

    fn parse_fragment(&mut self) -> ArtifactResult<String> {
        self.consume_required("<>", "expected JSX fragment")?;
        let children = self.parse_children(None)?;
        self.consume_required("</>", "React artifact JSX fragment was not closed")?;
        Ok(format!("h(Fragment, null{})", format_children(&children)))
    }

    fn parse_element(&mut self) -> ArtifactResult<String> {
        self.expect('<')?;
        if self.peek() == Some('/') {
            return Err(self.error("unexpected closing JSX tag"));
        }
        let tag = self.parse_name()?;
        let attrs = self.parse_attrs()?;
        if self.consume("/>") {
            return Ok(format!("h({}, {})", tag_expression(&tag), attrs));
        }
        self.expect('>')?;
        let children = self.parse_children(Some(&tag))?;
        let close = format!("</{tag}>");
        self.consume_required(
            &close,
            format!("React artifact JSX tag `{tag}` was not closed"),
        )?;
        Ok(format!(
            "h({}, {}{})",
            tag_expression(&tag),
            attrs,
            format_children(&children)
        ))
    }

    fn parse_children(&mut self, closing_tag: Option<&str>) -> ArtifactResult<Vec<String>> {
        let mut children = Vec::new();
        loop {
            if self.starts_with("</") {
                if let Some(tag) = closing_tag {
                    if self.starts_with(&format!("</{tag}>")) {
                        break;
                    }
                    return Err(
                        self.error(format!("unexpected closing JSX tag; expected </{tag}>"))
                    );
                }
                if self.starts_with("</>") {
                    break;
                }
                return Err(self.error("unexpected closing JSX tag"));
            }
            match self.peek() {
                Some('<') => children.push(self.parse_node()?),
                Some('{') => {
                    let expression = self.parse_braced_expression()?;
                    if !expression.trim().is_empty() {
                        children.push(expression);
                    }
                }
                Some(_) => {
                    let text = self.parse_text();
                    if !text.is_empty() {
                        children.push(json_string(&text));
                    }
                }
                None => break,
            }
        }
        Ok(children)
    }

    fn parse_attrs(&mut self) -> ArtifactResult<String> {
        let mut attrs = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with(">") || self.starts_with("/>") {
                break;
            }
            let name = self.parse_name()?;
            self.skip_ws();
            let value = if self.peek() == Some('=') {
                self.position += 1;
                self.skip_ws();
                self.parse_attr_value()?
            } else {
                "true".to_string()
            };
            attrs.push(format!("{}: {}", prop_key(&name), value));
        }
        if attrs.is_empty() {
            Ok("null".to_string())
        } else {
            Ok(format!("{{{}}}", attrs.join(", ")))
        }
    }

    fn parse_attr_value(&mut self) -> ArtifactResult<String> {
        match self.peek() {
            Some(quote @ ('"' | '\'')) => Ok(json_string(&self.parse_quoted_string(quote)?)),
            Some('{') => Ok(self.parse_braced_expression()?),
            _ => Err(self
                .error("JSX attributes must use quoted string values or JavaScript expressions")),
        }
    }

    fn parse_braced_expression(&mut self) -> ArtifactResult<String> {
        self.expect('{')?;
        let start = self.position;
        let mut nested = 1usize;
        while self.position < self.input.len() {
            let Some(character) = self.peek() else {
                break;
            };
            if character == '\'' || character == '"' || character == '`' {
                let (_, consumed) = read_js_string_like(&self.input[self.position..], character)?;
                self.position += consumed;
                continue;
            }
            if self.starts_with("//") {
                self.position = self.input[self.position..]
                    .find('\n')
                    .map(|offset| self.position + offset + 1)
                    .unwrap_or(self.input.len());
                continue;
            }
            if self.starts_with("/*") {
                self.position = self.input[self.position + 2..]
                    .find("*/")
                    .map(|offset| self.position + 2 + offset + 2)
                    .ok_or_else(|| self.error("JavaScript comment was not closed"))?;
                continue;
            }
            if character == '{' {
                nested += 1;
                self.position += 1;
                continue;
            }
            if character == '}' {
                nested -= 1;
                if nested == 0 {
                    let raw = &self.input[start..self.position];
                    let transformed =
                        transform_jsx_in_js(raw, self.full_source, self.base_offset + start)?;
                    self.position += 1;
                    return Ok(transformed.trim().to_string());
                }
                self.position += 1;
                continue;
            }
            self.position += character.len_utf8();
        }
        Err(self.error("JSX expression was not closed"))
    }

    fn parse_quoted_string(&mut self, quote: char) -> ArtifactResult<String> {
        self.position += quote.len_utf8();
        let mut value = String::new();
        while let Some(character) = self.peek() {
            self.position += character.len_utf8();
            if character == quote {
                return Ok(value);
            }
            if character == '\\' {
                let Some(escaped) = self.peek() else {
                    return Err(self.error("JSX attribute string was not closed"));
                };
                self.position += escaped.len_utf8();
                value.push(match escaped {
                    'n' => '\n',
                    'r' => '\r',
                    't' => '\t',
                    '\\' => '\\',
                    '"' => '"',
                    '\'' => '\'',
                    other => other,
                });
            } else {
                value.push(character);
            }
        }
        Err(self.error("JSX attribute string was not closed"))
    }

    fn parse_text(&mut self) -> String {
        let start = self.position;
        while let Some(character) = self.peek() {
            if character == '<' || character == '{' {
                break;
            }
            self.position += character.len_utf8();
        }
        self.input[start..self.position].to_string()
    }

    fn parse_name(&mut self) -> ArtifactResult<String> {
        let start = self.position;
        while let Some(character) = self.peek() {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.') {
                self.position += character.len_utf8();
            } else {
                break;
            }
        }
        if start == self.position {
            Err(self.error("expected JSX identifier"))
        } else {
            Ok(self.input[start..self.position].to_string())
        }
    }

    fn skip_ws(&mut self) {
        while let Some(character) = self.peek() {
            if !character.is_whitespace() {
                break;
            }
            self.position += character.len_utf8();
        }
    }

    fn expect(&mut self, expected: char) -> ArtifactResult<()> {
        if self.peek() == Some(expected) {
            self.position += expected.len_utf8();
            Ok(())
        } else {
            Err(self.error(format!("expected '{expected}' in JSX")))
        }
    }

    fn consume(&mut self, value: &str) -> bool {
        if self.starts_with(value) {
            self.position += value.len();
            true
        } else {
            false
        }
    }

    fn consume_required(&mut self, value: &str, message: impl Into<String>) -> ArtifactResult<()> {
        if self.consume(value) {
            Ok(())
        } else {
            Err(self.error(message))
        }
    }

    fn starts_with(&self, value: &str) -> bool {
        self.input[self.position..].starts_with(value)
    }

    fn peek(&self) -> Option<char> {
        self.input[self.position..].chars().next()
    }

    fn error(&self, message: impl Into<String>) -> ArtifactError {
        diagnostic_error(self.full_source, self.base_offset + self.position, message)
    }
}

fn tag_expression(tag: &str) -> String {
    if tag
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_uppercase())
        && tag.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '.'
        })
    {
        tag.to_string()
    } else {
        json_string(tag)
    }
}

fn prop_key(name: &str) -> String {
    if name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
        && name
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic() || character == '_')
    {
        name.to_string()
    } else {
        json_string(name)
    }
}

fn format_children(children: &[String]) -> String {
    if children.is_empty() {
        String::new()
    } else {
        format!(", {}", children.join(", "))
    }
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn runtime_document(component: &CompiledReactComponent, preview_token: Option<&str>) -> String {
    let token = json_string(preview_token.unwrap_or(""));
    let module = escape_script(&component.module);
    let scoped_css = escape_style(&component.scoped_css);
    let runtime = react_preview_runtime()
        .replace(PREVIEW_TOKEN_PLACEHOLDER, &token)
        .replace(COMPONENT_MODULE_PLACEHOLDER, &module);
    let csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"{csp}\"><style>{}{}</style></head><body><main id=\"terax-react-preview-root\" data-terax-artifact-scope=\"react-preview\"></main><script data-terax-react-runtime=\"true\">{}</script></body></html>",
        runtime_css(),
        scoped_css,
        runtime
    )
}

fn escape_script(value: &str) -> String {
    value.replace("</script", "<\\/script")
}

fn escape_style(value: &str) -> String {
    value.replace("</style", "<\\/style")
}

fn react_preview_runtime() -> &'static str {
    include_str!("react_preview_runtime.js")
}

fn runtime_css() -> &'static str {
    "html,body{margin:0;min-height:100%;background:#fff;color:#111;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}body{padding:24px}button,input,select,textarea{font:inherit}button{cursor:pointer}"
}

fn diagnostic_error(source: &str, offset: usize, message: impl Into<String>) -> ArtifactError {
    let message = message.into();
    let (line, column, excerpt) = source_location(source, offset.min(source.len()));
    let diagnostic = ArtifactDiagnostic::error("ARTIFACT_REACT_JSX_PARSE", message.clone())
        .with_location(line, column, line, column, excerpt.clone());
    ArtifactError::compile_failed(format!(
        "{} at line {}, column {}: {}",
        message,
        line,
        column,
        excerpt.trim()
    ))
    .with_diagnostics(vec![diagnostic])
}

fn source_location(source: &str, offset: usize) -> (usize, usize, String) {
    let mut line = 1usize;
    let mut line_start = 0usize;
    for (index, character) in source.char_indices() {
        if index >= offset {
            break;
        }
        if character == '\n' {
            line += 1;
            line_start = index + 1;
        }
    }
    let column = source[line_start..offset].chars().count() + 1;
    let line_end = source[offset..]
        .find('\n')
        .map(|relative| offset + relative)
        .unwrap_or(source.len());
    (line, column, source[line_start..line_end].to_string())
}

fn compile_error(message: impl Into<String>) -> ArtifactError {
    let message = message.into();
    ArtifactError::compile_failed_with_diagnostic(ArtifactDiagnostic::error(
        "ARTIFACT_REACT_COMPILE",
        message,
    ))
}

#[cfg(test)]
mod tests {
    use super::super::types::ArtifactDiagnosticSeverity;
    use super::*;

    fn input(content: &str) -> ReactCompileInput {
        ReactCompileInput {
            content: content.to_string(),
            preview_token: None,
        }
    }

    #[test]
    fn compiles_simple_default_react_component_to_sandbox_document() {
        let result = compile_react_artifact(input(
            r#"
export default function Card() {
  return <section className="hero"><h1>Hello</h1></section>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("terax-react-preview-root"));
        assert!(result.document.contains("Hello"));
        assert!(result.document.contains("hero"));
        assert!(result.diagnostics.is_empty());
        assert!(!result.document.contains("@tauri-apps"));
    }

    #[test]
    fn compiles_static_jsx_fragments_with_multiple_children() {
        let result = compile_react_artifact(input(
            r#"
export default function Card() {
  return <><h1>Hello</h1><p>World</p></>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("h(Fragment, null"));
        assert!(result.document.contains("World"));
        assert!(!result.document.contains("<>"));
    }

    #[test]
    fn compiles_literal_jsx_expressions_and_attributes() {
        let result = compile_react_artifact(input(
            r#"
export default function Card() {
  return <section className={"hero"} data-count={3} hidden={false}>{"Hello <safe>"}{42}{null}</section>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("className: \"hero\""));
        assert!(result.document.contains("\"data-count\": 3"));
        assert!(result.document.contains("hidden: false"));
        assert!(result.document.contains("Hello <safe>"));
    }

    #[test]
    fn compiles_state_hooks_events_and_dynamic_expressions_to_runtime_document() {
        let result = compile_react_artifact(ReactCompileInput {
            content: r#"
import { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button className="counter" onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
"#
            .to_string(),
            preview_token: Some("tok-123".to_string()),
        })
        .unwrap();

        assert!(result.document.contains("terax-react-runtime"));
        assert!(result.document.contains("useState"));
        assert!(result.document.contains("addEventListener"));
        assert!(result.document.contains("onClick"));
        assert!(result.document.contains("Count:"));
        assert!(result.document.contains("tok-123"));
        assert!(!result.document.contains("export default"));
    }

    #[test]
    fn compiles_nested_jsx_inside_dynamic_expressions() {
        let result = compile_react_artifact(input(
            r#"
export default function List() {
  const items = ["A", "B"];
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("items.map((item) => h(\"li\""));
        assert!(result.document.contains("key: item"));
    }

    #[test]
    fn compiles_exported_css_as_preview_scoped_styles() {
        let result = compile_react_artifact(input(
            r#"
export const css = ".card { color: red; } button:hover { color: blue; }";
export default function Card() {
  return <section className="card"><button>Go</button></section>;
}
"#,
        ))
        .unwrap();

        assert!(result
            .document
            .contains("data-terax-artifact-scope=\"react-preview\""));
        assert!(result
            .document
            .contains("[data-terax-artifact-scope=\"react-preview\"] .card"));
        assert!(result
            .document
            .contains("[data-terax-artifact-scope=\"react-preview\"] button:hover"));
        assert!(result.document.contains("color: red"));
        assert!(!result.document.contains("export const css"));
    }

    #[test]
    fn scopes_nested_media_css_without_breaking_wrapper() {
        let result = compile_react_artifact(input(
            r#"
export const styles = "@media (min-width: 600px) { .card { color: red; } .card:hover { color: blue; } } @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";
export default function Card() {
  return <section className="card">Responsive</section>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("@media (min-width: 600px){"));
        assert!(result
            .document
            .contains("[data-terax-artifact-scope=\"react-preview\"] .card{color: red;}"));
        assert!(result
            .document
            .contains("@keyframes pulse{from { opacity: 0; } to { opacity: 1; }}"));
    }

    #[test]
    fn allows_forbidden_call_names_inside_strings_and_comments() {
        let result = compile_react_artifact(input(
            r#"
export default function Copy() {
  const copy = "Please import(data) and require(example) in prose only";
  // import("not-real")
  return <p>{copy}</p>;
}
"#,
        ))
        .unwrap();

        assert!(result.document.contains("Please import(data)"));
    }

    #[test]
    fn reports_structured_diagnostics_for_jsx_errors() {
        let error = compile_react_artifact(input(
            r#"
export default function Broken() {
  return <section><h1>Oops</section>;
}
"#,
        ))
        .unwrap_err();

        assert_eq!(error.code, "ARTIFACT_COMPILE_FAILED");
        let diagnostic = error.diagnostics.first().unwrap();
        assert_eq!(diagnostic.code, "ARTIFACT_REACT_JSX_PARSE");
        assert_eq!(diagnostic.severity, ArtifactDiagnosticSeverity::Error);
        assert!(diagnostic.message.contains("unexpected closing JSX tag"));
        assert_eq!(diagnostic.line, Some(3));
        assert!(diagnostic.column.unwrap_or_default() > 0);
        assert_eq!(diagnostic.end_line, diagnostic.line);
        assert_eq!(diagnostic.end_column, diagnostic.column);
        assert!(diagnostic
            .excerpt
            .as_deref()
            .unwrap()
            .contains("return <section>"));
    }

    #[test]
    fn reports_line_column_and_excerpt_for_jsx_errors() {
        let error = compile_react_artifact(input(
            r#"
export default function Broken() {
  return <section><h1>Oops</section>;
}
"#,
        ))
        .unwrap_err();

        assert_eq!(error.code, "ARTIFACT_COMPILE_FAILED");
        assert!(
            error.message.contains("line 3, column"),
            "{}",
            error.message
        );
        assert!(
            error.message.contains("return <section>"),
            "{}",
            error.message
        );
    }

    #[test]
    fn rejects_workspace_network_and_unallowlisted_imports() {
        for content in [
            "import x from '../workspace'; export default function App() { return <div /> }",
            "import x from 'https://example.com/x.js'; export default function App() { return <div /> }",
            "import { invoke } from '@tauri-apps/api/core'; export default function App() { return <div /> }",
            "import fs from 'node:fs'; export default function App() { return <div /> }",
            "import{ map }from'lodash'; export default function App() { return <div /> }",
            "export { map } from 'lodash'; export default function App() { return <div /> }",
        ] {
            let error = compile_react_artifact(input(content)).unwrap_err();
            assert_eq!(error.code, "ARTIFACT_COMPILE_FAILED");
        }
    }
}
