use serde::{Deserialize, Serialize};

use super::types::{ArtifactError, ArtifactResult};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactCompileInput {
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReactCompileResult {
    pub document: String,
    pub diagnostics: Vec<String>,
}

pub fn compile_react_artifact(input: ReactCompileInput) -> ArtifactResult<ReactCompileResult> {
    validate_react_source(&input.content)?;
    let jsx = returned_jsx(&input.content)?;
    let mut parser = StaticJsxParser::new(jsx);
    let body = parser.parse_document()?;
    Ok(ReactCompileResult {
        document: sandbox_document(&body),
        diagnostics: Vec::new(),
    })
}

fn validate_react_source(source: &str) -> ArtifactResult<()> {
    if source.contains("import(") || source.contains("import (") || source.contains("require(") {
        return Err(compile_error(
            "React artifacts may not use dynamic imports or require()",
        ));
    }

    for specifier in static_module_specifiers(source)? {
        if !matches!(specifier.as_str(), "react" | "react/jsx-runtime") {
            return Err(compile_error(
                "React artifact imports are limited to the bundled React allowlist",
            ));
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

fn returned_jsx(source: &str) -> ArtifactResult<&str> {
    let return_index = source
        .find("return")
        .ok_or_else(|| compile_error("React artifact must return JSX"))?;
    let after_return = &source[return_index + "return".len()..];
    let start = after_return
        .find('<')
        .ok_or_else(|| compile_error("React artifact return value must be static JSX"))?;
    Ok(&after_return[start..])
}

struct StaticJsxParser<'a> {
    input: &'a str,
    position: usize,
}

impl<'a> StaticJsxParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, position: 0 }
    }

    fn parse_document(&mut self) -> ArtifactResult<String> {
        let html = self.parse_node()?;
        self.skip_ws();
        if self.peek() == Some(';') {
            self.position += 1;
        }
        Ok(html)
    }

    fn parse_node(&mut self) -> ArtifactResult<String> {
        if self.starts_with("<>") {
            self.parse_fragment()
        } else {
            self.parse_element()
        }
    }

    fn parse_fragment(&mut self) -> ArtifactResult<String> {
        if !self.consume("<>") {
            return Err(compile_error("expected JSX fragment"));
        }
        let mut children = String::new();
        loop {
            if self.consume("</>") {
                break;
            }
            match self.peek() {
                Some('<') if self.starts_with("</") => {
                    return Err(compile_error("unexpected closing JSX tag"));
                }
                Some('<') => children.push_str(&self.parse_node()?),
                Some('{') => {
                    return Err(compile_error(
                        "JSX expressions are not supported in React artifact static preview yet",
                    ));
                }
                Some(_) => children.push_str(&escape_html(&self.parse_text())),
                None => return Err(compile_error("React artifact JSX fragment was not closed")),
            }
        }
        Ok(children)
    }

    fn parse_element(&mut self) -> ArtifactResult<String> {
        self.expect('<')?;
        if self.peek() == Some('/') {
            return Err(compile_error("unexpected closing JSX tag"));
        }
        let tag = self.parse_name()?;
        let attrs = self.parse_attrs()?;
        if self.consume("/>") {
            return Ok(format!("<{tag}{attrs}></{tag}>"));
        }
        self.expect('>')?;

        let mut children = String::new();
        loop {
            if self.consume(&format!("</{tag}>")) {
                break;
            }
            match self.peek() {
                Some('<') => children.push_str(&self.parse_node()?),
                Some('{') => {
                    return Err(compile_error(
                        "JSX expressions are not supported in React artifact static preview yet",
                    ));
                }
                Some(_) => children.push_str(&escape_html(&self.parse_text())),
                None => return Err(compile_error("React artifact JSX tag was not closed")),
            }
        }

        Ok(format!("<{tag}{attrs}>{children}</{tag}>"))
    }

    fn parse_attrs(&mut self) -> ArtifactResult<String> {
        let mut attrs = String::new();
        loop {
            self.skip_ws();
            if self.starts_with(">") || self.starts_with("/>") {
                break;
            }
            let name = self.parse_name()?;
            let html_name = if name == "className" { "class" } else { &name };
            self.skip_ws();
            if self.peek() == Some('=') {
                self.position += 1;
                self.skip_ws();
                let value = self.parse_attr_value()?;
                attrs.push(' ');
                attrs.push_str(html_name);
                attrs.push_str("=\"");
                attrs.push_str(&escape_html_attr(&value));
                attrs.push('"');
            } else {
                attrs.push(' ');
                attrs.push_str(html_name);
            }
        }
        Ok(attrs)
    }

    fn parse_attr_value(&mut self) -> ArtifactResult<String> {
        match self.peek() {
            Some(quote @ ('"' | '\'')) => {
                self.position += quote.len_utf8();
                let start = self.position;
                while let Some(character) = self.peek() {
                    if character == quote {
                        let value = self.input[start..self.position].to_string();
                        self.position += quote.len_utf8();
                        return Ok(value);
                    }
                    self.position += character.len_utf8();
                }
                Err(compile_error("JSX attribute string was not closed"))
            }
            Some('{') => Err(compile_error(
                "JSX attribute expressions are not supported in React artifact static preview yet",
            )),
            _ => Err(compile_error(
                "JSX attributes must use quoted string values in React artifact static preview",
            )),
        }
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
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':') {
                self.position += character.len_utf8();
            } else {
                break;
            }
        }
        if start == self.position {
            Err(compile_error("expected JSX identifier"))
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
            Err(compile_error(format!("expected '{expected}' in JSX")))
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

    fn starts_with(&self, value: &str) -> bool {
        self.input[self.position..].starts_with(value)
    }

    fn peek(&self) -> Option<char> {
        self.input[self.position..].chars().next()
    }
}

fn sandbox_document(body: &str) -> String {
    let csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"{csp}\"><style>html,body{{margin:0;min-height:100%;background:#fff;color:#111;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}}body{{padding:24px}}</style></head><body><main id=\"terax-react-preview-root\">{body}</main></body></html>"
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_html_attr(value: &str) -> String {
    escape_html(value)
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn compile_error(message: impl Into<String>) -> ArtifactError {
    ArtifactError::compile_failed(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_simple_default_react_component_to_sandbox_document() {
        let result = compile_react_artifact(ReactCompileInput {
            content: r#"
export default function Card() {
  return <section className="hero"><h1>Hello</h1></section>;
}
"#
            .to_string(),
        })
        .unwrap();

        assert!(result.document.contains("terax-react-preview-root"));
        assert!(result.document.contains("Hello"));
        assert!(result.document.contains("hero"));
        assert!(result.diagnostics.is_empty());
        assert!(!result.document.contains("@tauri-apps"));
    }

    #[test]
    fn compiles_static_jsx_fragments_with_multiple_children() {
        let result = compile_react_artifact(ReactCompileInput {
            content: r#"
export default function Card() {
  return <><h1>Hello</h1><p>World</p></>;
}
"#
            .to_string(),
        })
        .unwrap();

        assert!(result.document.contains("<h1>Hello</h1><p>World</p>"));
        assert!(!result.document.contains("<>"));
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
            let error = compile_react_artifact(ReactCompileInput {
                content: content.to_string(),
            })
            .unwrap_err();
            assert_eq!(error.code, "ARTIFACT_COMPILE_FAILED");
        }
    }
}
