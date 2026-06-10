#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::TcpStream;

use serde_json::Value;
use terax_lib::modules::mcp::{McpServerConfig, McpTransport};

pub fn stdio_config(
    id: &str,
    name: &str,
    script: &std::path::Path,
    cwd: &std::path::Path,
) -> McpServerConfig {
    McpServerConfig {
        id: id.to_string(),
        name: name.to_string(),
        transport: McpTransport::Stdio,
        command: "node".to_string(),
        args: vec![script.to_string_lossy().into_owned()],
        cwd: Some(cwd.to_string_lossy().into_owned()),
        url: None,
        oauth_token_env: None,
        env: vec![],
    }
}

pub fn read_http_request(stream: &mut TcpStream) -> (String, Value) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 512];
    loop {
        let size = stream.read(&mut chunk).unwrap();
        assert!(size > 0, "HTTP client closed before headers");
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap()
        + 4;
    let headers = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                (name.eq_ignore_ascii_case("content-length"))
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
        })
        .unwrap_or(0);
    while buffer.len() < header_end + content_length {
        let size = stream.read(&mut chunk).unwrap();
        assert!(size > 0, "HTTP client closed before body");
        buffer.extend_from_slice(&chunk[..size]);
    }
    let body = serde_json::from_slice(&buffer[header_end..header_end + content_length]).unwrap();
    (headers, body)
}

pub fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    headers: &[(&str, &str)],
    body: &str,
) {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");
    response.push_str(body);
    stream.write_all(response.as_bytes()).unwrap();
}

pub fn read_http_request_text(stream: &mut TcpStream) -> (String, String) {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 512];
    loop {
        let size = stream.read(&mut chunk).unwrap();
        assert!(size > 0, "HTTP client closed before headers");
        buffer.extend_from_slice(&chunk[..size]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap()
        + 4;
    let headers = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                (name.eq_ignore_ascii_case("content-length"))
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
        })
        .unwrap_or(0);
    while buffer.len() < header_end + content_length {
        let size = stream.read(&mut chunk).unwrap();
        assert!(size > 0, "HTTP client closed before body");
        buffer.extend_from_slice(&chunk[..size]);
    }
    (
        headers,
        String::from_utf8_lossy(&buffer[header_end..header_end + content_length]).into_owned(),
    )
}
