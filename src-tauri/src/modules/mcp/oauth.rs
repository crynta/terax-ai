use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::config_store::{mcp_server_configs_list_at_path, write_server_configs_at_path};
use super::connections::sanitize_stderr_text;
use super::sanitize::{is_safe_env_name, sanitize_server_id, validate_http_url};
use super::{
    McpOAuthCallbackWaitRequest, McpOAuthCallbackWaitResult, McpOAuthCompleteRequest,
    McpOAuthMetadata, McpOAuthStartRequest, McpOAuthStartResult, McpOAuthTokenResponse,
    McpStoredEnvVar, McpStoredServerConfig, McpTransport, MCP_HTTP_BODY_LIMIT,
    MCP_OAUTH_CLIENT_NAME, MCP_OAUTH_DEFAULT_SCOPE, MCP_OAUTH_FALLBACK_CLIENT_ID,
    MCP_OAUTH_REDIRECT_URI, MCP_REQUEST_TIMEOUT, MCP_STORED_TEXT_LIMIT,
};

pub async fn mcp_oauth_start_at_path(
    path: &Path,
    request: McpOAuthStartRequest,
) -> Result<McpOAuthStartResult, String> {
    let record = mcp_stored_config_by_id(path, &request.server_id)?;
    if record.transport != McpTransport::Http {
        return Err("MCP OAuth is only available for HTTP servers".to_string());
    }
    let resource = record
        .url
        .as_deref()
        .ok_or_else(|| "MCP HTTP config is missing a URL".to_string())?;
    let metadata = discover_oauth_metadata(resource).await?;
    let redirect_uri = request
        .redirect_uri
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(MCP_OAUTH_REDIRECT_URI);
    let redirect_uri = validate_oauth_redirect_uri(redirect_uri)?;
    let scopes = sanitize_oauth_scopes(request.scopes)?;
    let client_id = match request
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(client_id) => validate_oauth_client_id(client_id)?,
        None => register_oauth_client(&metadata, &redirect_uri)
            .await?
            .unwrap_or_else(|| MCP_OAUTH_FALLBACK_CLIENT_ID.to_string()),
    };
    let state = generate_oauth_secret(24)?;
    let code_verifier = generate_oauth_secret(48)?;
    let token_env = record
        .oauth_token_env
        .as_deref()
        .map(str::to_string)
        .unwrap_or_else(|| default_oauth_token_env(&record.id));
    let authorization_url = build_oauth_authorization_url(
        &metadata,
        resource,
        &client_id,
        &redirect_uri,
        &state,
        &code_verifier,
        &scopes,
    )?;
    Ok(McpOAuthStartResult {
        server_id: record.id,
        authorization_url,
        state,
        code_verifier,
        redirect_uri,
        client_id,
        token_env,
        scopes,
    })
}

pub async fn mcp_oauth_complete_at_path(
    path: &Path,
    request: &McpOAuthCompleteRequest,
) -> Result<McpOAuthTokenResponse, String> {
    let record = mcp_stored_config_by_id(path, &request.server_id)?;
    if record.transport != McpTransport::Http {
        return Err("MCP OAuth is only available for HTTP servers".to_string());
    }
    let resource = record
        .url
        .as_deref()
        .ok_or_else(|| "MCP HTTP config is missing a URL".to_string())?;
    let token_env = validate_oauth_token_env(&request.token_env)?;
    let (code, redirect_state) = extract_oauth_code(&request.code_or_redirect_url)?;
    if let Some(redirect_state) = redirect_state {
        if redirect_state != request.state {
            return Err("MCP OAuth redirect state did not match".to_string());
        }
    }
    let metadata = discover_oauth_metadata(resource).await?;
    let token = exchange_oauth_code(
        &metadata,
        resource,
        &request.client_id,
        &request.redirect_uri,
        &request.code_verifier,
        &code,
    )
    .await?;
    ensure_oauth_token_env_at_path(path, &record.id, &token_env)?;
    Ok(token)
}

pub fn mcp_oauth_wait_for_callback_once(
    request: &McpOAuthCallbackWaitRequest,
) -> Result<McpOAuthCallbackWaitResult, String> {
    let state = validate_oauth_code_value(&request.state, "MCP OAuth state")?;
    let redirect_uri = validate_oauth_redirect_uri(&request.redirect_uri)?;
    let parsed = reqwest::Url::parse(&redirect_uri)
        .map_err(|error| format!("invalid redirect URI: {error}"))?;
    if parsed.scheme() != "http" {
        return Err("MCP OAuth callback listener requires an http redirect URI".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "redirect URI must include a host".to_string())?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err("MCP OAuth callback listener only supports loopback hosts".to_string());
    }
    let port = parsed
        .port()
        .ok_or_else(|| "MCP OAuth callback redirect URI must include a port".to_string())?;
    let path = parsed.path().to_string();
    let listener = TcpListener::bind((host, port))
        .map_err(|error| format!("MCP OAuth callback listener failed: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("MCP OAuth callback listener setup failed: {error}"))?;
    let timeout =
        Duration::from_millis(request.timeout_ms.unwrap_or(120_000).clamp(1_000, 300_000));
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _addr)) => {
                let result = handle_oauth_callback_stream(&mut stream, &parsed, &path, &state);
                let _ = write_oauth_callback_response(&mut stream, result.is_ok());
                return result.map(|code_or_redirect_url| McpOAuthCallbackWaitResult {
                    code_or_redirect_url,
                });
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("MCP OAuth callback timed out".to_string());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(format!("MCP OAuth callback listener failed: {error}")),
        }
    }
}

fn handle_oauth_callback_stream(
    stream: &mut TcpStream,
    redirect_uri: &reqwest::Url,
    expected_path: &str,
    expected_state: &str,
) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("MCP OAuth callback setup failed: {error}"))?;
    let mut reader = BufReader::new(stream);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|error| format!("MCP OAuth callback read failed: {error}"))?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || !target.starts_with('/') {
        return Err("MCP OAuth callback request is invalid".to_string());
    }
    let target_path = target.split('?').next().unwrap_or_default();
    if target_path != expected_path {
        return Err("MCP OAuth callback path did not match".to_string());
    }
    let host = redirect_uri
        .host_str()
        .ok_or_else(|| "redirect URI must include a host".to_string())?;
    let port = redirect_uri
        .port()
        .ok_or_else(|| "MCP OAuth callback redirect URI must include a port".to_string())?;
    let code_or_redirect_url = format!("{}://{}:{}{}", redirect_uri.scheme(), host, port, target);
    let (_code, redirect_state) = extract_oauth_code(&code_or_redirect_url)?;
    if redirect_state.as_deref() != Some(expected_state) {
        return Err("MCP OAuth redirect state did not match".to_string());
    }
    Ok(code_or_redirect_url)
}

fn write_oauth_callback_response(stream: &mut TcpStream, ok: bool) -> Result<(), String> {
    let (status, title, body) = if ok {
        (
            "200 OK",
            "MCP OAuth complete",
            "You can close this browser tab and return to Terax.",
        )
    } else {
        (
            "400 Bad Request",
            "MCP OAuth failed",
            "Return to Terax and paste the redirect URL manually.",
        )
    };
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title><body><h1>{title}</h1><p>{body}</p></body>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| format!("MCP OAuth callback response failed: {error}"))
}

fn mcp_stored_config_by_id(path: &Path, server_id: &str) -> Result<McpStoredServerConfig, String> {
    let server_id = sanitize_server_id(server_id)?;
    mcp_server_configs_list_at_path(path)?
        .into_iter()
        .find(|record| record.id == server_id)
        .ok_or_else(|| format!("MCP server config is not saved: {server_id}"))
}

fn ensure_oauth_token_env_at_path(
    path: &Path,
    server_id: &str,
    token_env: &str,
) -> Result<McpStoredServerConfig, String> {
    let server_id = sanitize_server_id(server_id)?;
    let token_env = validate_oauth_token_env(token_env)?;
    let mut records = mcp_server_configs_list_at_path(path)?;
    let record = records
        .iter_mut()
        .find(|record| record.id == server_id)
        .ok_or_else(|| format!("MCP server config is not saved: {server_id}"))?;
    record.oauth_token_env = Some(token_env.clone());
    if !record.env.iter().any(|env| env.name == token_env) {
        record.env.push(McpStoredEnvVar { name: token_env });
        record.env.sort_by(|left, right| left.name.cmp(&right.name));
    }
    let saved = record.clone();
    write_server_configs_at_path(path, &records)?;
    Ok(saved)
}

async fn discover_oauth_metadata(resource_url: &str) -> Result<McpOAuthMetadata, String> {
    let client = reqwest::Client::builder()
        .timeout(MCP_REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("failed to create MCP OAuth client: {error}"))?;
    for url in oauth_metadata_urls_for_resource(resource_url)? {
        let Ok(value) = fetch_oauth_json(&client, &url).await else {
            continue;
        };
        if let Some(metadata) = parse_oauth_metadata_value(&value)? {
            return Ok(metadata);
        }
        for issuer in oauth_authorization_servers(&value) {
            for metadata_url in oauth_authorization_server_metadata_urls(&issuer) {
                let Ok(value) = fetch_oauth_json(&client, &metadata_url).await else {
                    continue;
                };
                if let Some(metadata) = parse_oauth_metadata_value(&value)? {
                    return Ok(metadata);
                }
            }
        }
    }
    Err("MCP OAuth metadata discovery failed".to_string())
}

async fn fetch_oauth_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("MCP OAuth metadata request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("MCP OAuth metadata returned {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("MCP OAuth metadata body failed: {error}"))?;
    if bytes.len() > MCP_HTTP_BODY_LIMIT {
        return Err("MCP OAuth metadata response body too large".to_string());
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("invalid MCP OAuth metadata: {error}"))
}

fn oauth_metadata_urls_for_resource(resource_url: &str) -> Result<Vec<String>, String> {
    let parsed = reqwest::Url::parse(&validate_http_url(Some(resource_url))?)
        .map_err(|error| format!("MCP HTTP URL is invalid: {error}"))?;
    let mut urls = Vec::new();
    for path in [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
    ] {
        if let Ok(url) = parsed.join(path) {
            urls.push(url.to_string());
        }
    }
    urls.dedup();
    Ok(urls)
}

fn oauth_authorization_servers(value: &Value) -> Vec<String> {
    let mut issuers = Vec::new();
    if let Some(issuer) = value.get("authorization_server").and_then(Value::as_str) {
        issuers.push(issuer.to_string());
    }
    if let Some(values) = value.get("authorization_servers").and_then(Value::as_array) {
        issuers.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
    }
    issuers.retain(|issuer| !issuer.trim().is_empty());
    issuers.sort();
    issuers.dedup();
    issuers
}

fn oauth_authorization_server_metadata_urls(issuer: &str) -> Vec<String> {
    let Ok(parsed) = reqwest::Url::parse(issuer.trim()) else {
        return Vec::new();
    };
    let mut urls = Vec::new();
    for path in [
        "/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
    ] {
        if let Ok(url) = parsed.join(path) {
            urls.push(url.to_string());
        }
    }
    urls
}

fn parse_oauth_metadata_value(value: &Value) -> Result<Option<McpOAuthMetadata>, String> {
    let Some(authorization_endpoint) = value.get("authorization_endpoint").and_then(Value::as_str)
    else {
        return Ok(None);
    };
    let Some(token_endpoint) = value.get("token_endpoint").and_then(Value::as_str) else {
        return Ok(None);
    };
    let registration_endpoint = value
        .get("registration_endpoint")
        .and_then(Value::as_str)
        .map(|endpoint| validate_http_url(Some(endpoint)))
        .transpose()?;
    Ok(Some(McpOAuthMetadata {
        authorization_endpoint: validate_http_url(Some(authorization_endpoint))?,
        token_endpoint: validate_http_url(Some(token_endpoint))?,
        registration_endpoint,
    }))
}

async fn register_oauth_client(
    metadata: &McpOAuthMetadata,
    redirect_uri: &str,
) -> Result<Option<String>, String> {
    let Some(endpoint) = metadata.registration_endpoint.as_deref() else {
        return Ok(None);
    };
    let client = reqwest::Client::builder()
        .timeout(MCP_REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("failed to create MCP OAuth client: {error}"))?;
    let body = serde_json::to_vec(&json!({
        "client_name": MCP_OAUTH_CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    }))
    .map_err(|error| error.to_string())?;
    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(ACCEPT, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("MCP OAuth client registration failed: {error}"))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("MCP OAuth registration body failed: {error}"))?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid MCP OAuth registration response: {error}"))?;
    value
        .get("client_id")
        .and_then(Value::as_str)
        .map(validate_oauth_client_id)
        .transpose()
}

async fn exchange_oauth_code(
    metadata: &McpOAuthMetadata,
    resource: &str,
    client_id: &str,
    redirect_uri: &str,
    code_verifier: &str,
    code: &str,
) -> Result<McpOAuthTokenResponse, String> {
    let client_id = validate_oauth_client_id(client_id)?;
    let redirect_uri = validate_oauth_redirect_uri(redirect_uri)?;
    let code_verifier = validate_oauth_code_value(code_verifier, "MCP OAuth code verifier")?;
    let code = validate_oauth_code_value(code, "MCP OAuth authorization code")?;
    let body = form_urlencoded(&[
        ("grant_type", "authorization_code"),
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", code_verifier.as_str()),
        ("code", code.as_str()),
        ("resource", resource),
    ])?;
    let client = reqwest::Client::builder()
        .timeout(MCP_REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("failed to create MCP OAuth client: {error}"))?;
    let response = client
        .post(&metadata.token_endpoint)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("MCP OAuth token exchange failed: {error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("MCP OAuth token body failed: {error}"))?;
    if bytes.len() > MCP_HTTP_BODY_LIMIT {
        return Err("MCP OAuth token response body too large".to_string());
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("invalid MCP OAuth token response: {error}"))?;
    if !status.is_success() {
        let message = value
            .get("error_description")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("MCP OAuth token exchange failed");
        return Err(sanitize_stderr_text(message));
    }
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "MCP OAuth token response did not include an access token".to_string())?;
    Ok(McpOAuthTokenResponse {
        access_token,
        expires_in: value.get("expires_in").and_then(Value::as_u64),
        scope: value
            .get("scope")
            .and_then(Value::as_str)
            .map(sanitize_stderr_text)
            .filter(|scope| !scope.is_empty()),
    })
}

fn build_oauth_authorization_url(
    metadata: &McpOAuthMetadata,
    resource: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    code_verifier: &str,
    scopes: &[String],
) -> Result<String, String> {
    let mut url = reqwest::Url::parse(&metadata.authorization_endpoint)
        .map_err(|error| format!("MCP OAuth authorization endpoint is invalid: {error}"))?;
    let code_challenge = pkce_code_challenge(code_verifier);
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("state", state);
        query.append_pair("code_challenge", &code_challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("resource", resource);
        if !scopes.is_empty() {
            query.append_pair("scope", &scopes.join(" "));
        }
    }
    Ok(url.to_string())
}

fn form_urlencoded(pairs: &[(&str, &str)]) -> Result<String, String> {
    let mut url = reqwest::Url::parse("http://localhost/")
        .map_err(|error| format!("MCP form encoder base URL is invalid: {error}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in pairs {
            query.append_pair(key, value);
        }
    }
    Ok(url.query().unwrap_or_default().to_string())
}

fn extract_oauth_code(input: &str) -> Result<(String, Option<String>), String> {
    let value = input.trim();
    if value.is_empty() {
        return Err("MCP OAuth authorization code is required".to_string());
    }
    if let Ok(url) = reqwest::Url::parse(value) {
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.to_string()),
                "state" => state = Some(value.to_string()),
                "error" => error = Some(value.to_string()),
                _ => {}
            }
        }
        if let Some(error) = error {
            return Err(format!("MCP OAuth authorization failed: {error}"));
        }
        return Ok((
            code.ok_or_else(|| "MCP OAuth redirect did not include a code".to_string())?,
            state,
        ));
    }
    Ok((
        validate_oauth_code_value(value, "MCP OAuth authorization code")?,
        None,
    ))
}

fn generate_oauth_secret(byte_len: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_len];
    getrandom::fill(&mut bytes).map_err(|error| format!("MCP OAuth random failed: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_code_challenge(code_verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()))
}

fn sanitize_oauth_scopes(scopes: Vec<String>) -> Result<Vec<String>, String> {
    let mut sanitized = Vec::new();
    for scope in scopes.into_iter().take(16) {
        let scope = validate_oauth_code_value(&scope, "MCP OAuth scope")?;
        if !scope.is_empty() && !sanitized.contains(&scope) {
            sanitized.push(scope);
        }
    }
    if sanitized.is_empty() {
        sanitized.push(MCP_OAUTH_DEFAULT_SCOPE.to_string());
    }
    Ok(sanitized)
}

fn validate_oauth_client_id(value: &str) -> Result<String, String> {
    validate_oauth_code_value(value, "MCP OAuth client id")
}

fn validate_oauth_token_env(value: &str) -> Result<String, String> {
    let value = value.trim();
    if is_safe_env_name(value) {
        Ok(value.to_string())
    } else {
        Err("MCP OAuth token env name is not allowed".to_string())
    }
}

fn validate_oauth_code_value(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if value.len() > MCP_STORED_TEXT_LIMIT || value.chars().any(|ch| ch.is_control()) {
        return Err(format!("{field} contains unsupported characters"));
    }
    Ok(value.to_string())
}

fn validate_oauth_redirect_uri(value: &str) -> Result<String, String> {
    let parsed =
        reqwest::Url::parse(value).map_err(|error| format!("invalid redirect URI: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("redirect URI scheme not allowed: {scheme}")),
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("redirect URI must not contain credentials".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("redirect URI must include a host".to_string());
    }
    Ok(parsed.to_string())
}

fn default_oauth_token_env(server_id: &str) -> String {
    let mut name = String::new();
    for ch in server_id.chars() {
        if ch.is_ascii_alphanumeric() {
            name.push(ch.to_ascii_uppercase());
        } else {
            name.push('_');
        }
    }
    if name.is_empty() {
        "MCP_OAUTH_TOKEN".to_string()
    } else {
        format!("{name}_MCP_OAUTH_TOKEN")
    }
}
