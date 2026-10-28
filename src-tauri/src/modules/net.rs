use std::borrow::Cow;
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};

use bytes::Bytes;
use futures_util::{future::Abortable, FutureExt, StreamExt};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, JavaScriptChannelId, Request, Response};
use tauri::{State, WebviewWindow};

mod clients;
mod ip;
mod stream;
use super::ipc_body;
use clients::{client_for, Profile};
use ip::{ip_kind, IpKind};
pub use stream::AiStreamState;

const HEADER_BLOCKLIST: &[&str] = &[
    "host",
    "content-length",
    "connection",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "transfer-encoding",
    "upgrade",
    "trailer",
    "expect",
];

fn is_blocked_host_name(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    matches!(
        host.as_str(),
        "metadata.google.internal" | "metadata" | "metadata.azure.com"
    )
}

/// Resolve `host` once and return both its safety classification and the
/// concrete IPs we resolved. Callers can pin reqwest to these IPs to defeat
/// DNS rebinding (where a second lookup returns a different address).
async fn resolve_and_classify(host: &str) -> Result<(IpKind, Vec<IpAddr>), String> {
    // Direct literal? Skip DNS. `Url::host_str` keeps the brackets of IPv6.
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        return Ok((ip_kind(ip), vec![ip]));
    }
    let host_owned = host.to_string();
    let lookup = tokio::task::spawn_blocking(move || {
        (host_owned.as_str(), 0u16)
            .to_socket_addrs()
            .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("dns: {e}"))?;
    if lookup.is_empty() {
        return Err("dns: no addresses".into());
    }
    let mut worst = IpKind::Public;
    for ip in &lookup {
        let k = ip_kind(*ip);
        worst = match (worst, k) {
            (_, IpKind::BlockedMetadata) => IpKind::BlockedMetadata,
            (IpKind::BlockedMetadata, _) => IpKind::BlockedMetadata,
            (IpKind::Public, x) => x,
            (x, IpKind::Public) => x,
            (a, _) => a,
        };
    }
    Ok((worst, lookup))
}

fn validate_url(url: &str, allow_private: bool) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("scheme not allowed: {s}")),
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("userinfo in url is not allowed".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?;
    if is_blocked_host_name(host) {
        return Err(format!("host not allowed: {host}"));
    }
    // The actual IP classification has to be async — caller does it.
    let _ = allow_private;
    Ok(parsed)
}

/// Classify the host AND return safe IPs to pin reqwest's resolver to.
/// Defeats DNS rebinding (second-lookup-returns-different-IP) by reusing
/// exactly the addresses that passed `ip_kind`.
async fn classify_and_collect_safe_ips(
    host: &str,
    allow_private: bool,
) -> Result<Vec<IpAddr>, String> {
    let (worst, ips) = resolve_and_classify(host).await?;
    match worst {
        IpKind::BlockedMetadata => return Err(format!("host not allowed: {host}")),
        IpKind::Loopback | IpKind::Private if !allow_private => {
            return Err(format!(
                "host {host} resolves to a private/loopback address; this endpoint requires explicit opt-in",
            ));
        }
        _ => {}
    }
    let safe: Vec<IpAddr> = ips
        .into_iter()
        .filter(|ip| match ip_kind(*ip) {
            IpKind::BlockedMetadata => false,
            IpKind::Loopback | IpKind::Private => allow_private,
            IpKind::Public => true,
        })
        .collect();
    if safe.is_empty() {
        return Err(format!("host {host}: no safe IPs"));
    }
    Ok(safe)
}

fn sanitize_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    let Some(h) = headers else { return Ok(map) };
    for (k, v) in h {
        let lower = k.to_ascii_lowercase();
        if HEADER_BLOCKLIST.contains(&lower.as_str()) {
            return Err(format!("header not allowed: {k}"));
        }
        // CRLF injection: header value must not contain CR / LF / NUL.
        if v.as_bytes().iter().any(|b| matches!(b, 0 | b'\r' | b'\n')) {
            return Err(format!("header value contains control bytes: {k}"));
        }
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(&v).map_err(|e| e.to_string())?;
        map.insert(name, value);
    }
    Ok(map)
}

#[tauri::command]
pub async fn lm_ping(base_url: String) -> Result<u16, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("empty base url".into());
    }
    let probe = format!("{trimmed}/models");
    let parsed = validate_url(&probe, true)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "missing host".to_string())?
        .to_string();
    let safe_ips = classify_and_collect_safe_ips(&host, true).await?;

    let client = client_for(Profile::Ping, &host, &safe_ips, true)?;
    client
        .get(parsed)
        .send()
        .await
        .map(|r| r.status().as_u16())
        .map_err(|e| e.to_string())
}

// AI HTTP proxy — bypasses webview CORS / Mixed-Content / PNA so local-network
// model servers (LM Studio, Ollama, vLLM) work in the production bundle.

fn build_request(
    client: &reqwest::Client,
    method: &str,
    url: reqwest::Url,
    headers: Option<HashMap<String, String>>,
    body: Option<Bytes>,
) -> Result<reqwest::RequestBuilder, String> {
    let method = Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, url);
    let map = sanitize_headers(headers)?;
    req = req.headers(map);
    if let Some(b) = body {
        req = req.body(b);
    }
    Ok(req)
}

fn header_map_to_strings(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::with_capacity(headers.len());
    for (k, v) in headers {
        if let Ok(s) = v.to_str() {
            out.insert(k.as_str().to_ascii_lowercase(), s.to_string());
        }
    }
    out
}

#[derive(Serialize)]
struct StreamHeaders {
    status: u16,
    headers: HashMap<String, String>,
}

/// Packet kinds the webview decodes: 0 headers, 1 body, 2 end, 3 error.
fn stream_packet(kind: u8, bytes: &[u8]) -> Response {
    let mut packet = Vec::with_capacity(bytes.len() + 1);
    packet.push(kind);
    packet.extend_from_slice(bytes);
    Response::new(packet)
}

const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;

/// The IPC message owns the request buffer and frees it when the command
/// returns, while the request task outlives the command, so exactly one copy
/// is needed to hand the body over. The platform fallback that delivers JSON
/// instead of raw bytes is handled by `ipc_body`.
fn request_body(body: &InvokeBody) -> Result<Option<Bytes>, String> {
    let bytes = ipc_body::bytes_of(body, MAX_REQUEST_BYTES, ipc_body::JSON_FALLBACK_MAX_BYTES)?;
    Ok(match bytes {
        _ if bytes.is_empty() => None,
        Cow::Borrowed(raw) => Some(Bytes::copy_from_slice(raw)),
        Cow::Owned(vec) => Some(Bytes::from(vec)),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamRequest {
    request_id: String,
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    allow_private_network: Option<bool>,
    on_event: JavaScriptChannelId,
}

#[tauri::command]
pub async fn ai_http_stream(
    window: WebviewWindow,
    state: State<'_, AiStreamState>,
    request: Request<'_>,
) -> Result<(), String> {
    let metadata = request
        .headers()
        .get("x-terax-ai-request")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 64 * 1024)
        .ok_or("missing or oversized AI request metadata")?;
    let StreamRequest {
        request_id,
        url,
        method,
        headers,
        allow_private_network,
        on_event,
    } = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
    let on_event = on_event.channel_on::<_, Response>(window.as_ref().clone());
    let body = request_body(request.body())?;
    let (lease, registration) = state.start(window.label(), &request_id)?;
    tauri::async_runtime::spawn(async move {
        let run = async {
            let allow_private = allow_private_network.unwrap_or(false);
            let parsed = validate_url(&url, allow_private)?;
            let host = parsed.host_str().ok_or("missing host")?.to_string();
            let safe_ips = classify_and_collect_safe_ips(&host, allow_private).await?;
            let client = client_for(Profile::Stream, &host, &safe_ips, allow_private)?;
            let request = build_request(&client, &method, parsed, headers, body)?;
            let response = request.send().await.map_err(|e| e.to_string())?;
            let metadata = serde_json::to_vec(&StreamHeaders {
                status: response.status().as_u16(),
                headers: header_map_to_strings(response.headers()),
            })
            .map_err(|e| e.to_string())?;
            on_event
                .send(stream_packet(0, &metadata))
                .map_err(|e| e.to_string())?;
            pump(response.bytes_stream(), &lease.control, |packet| {
                on_event
                    .send(Response::new(packet))
                    .map_err(|e| e.to_string())
            })
            .await?;
            on_event
                .send(stream_packet(2, &[]))
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        };
        if let Ok(Err(error)) = Abortable::new(run, registration).await {
            let _ = on_event.send(stream_packet(3, error.as_bytes()));
        }
        drop(lease);
    });
    Ok(())
}

/// Moves a response body to the webview under byte-window flow control.
/// Network chunks that are already available are coalesced into one packet, and
/// while the window is full the next packet keeps filling from the network, so
/// a slow consumer sees fewer, larger messages rather than a backlog of tiny
/// ones.
async fn pump<S, E>(
    mut chunks: S,
    control: &stream::StreamControl,
    mut send: impl FnMut(Vec<u8>) -> Result<(), String>,
) -> Result<(), String>
where
    S: futures_util::Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    use stream::{fill_packet, new_packet, payload_len, CHUNK_BYTES};

    let mut packet = new_packet(1, 0);
    let mut carry = Bytes::new();
    // A network failure still delivers whatever arrived before it.
    let mut ended = false;
    let mut failure: Option<String> = None;
    loop {
        fill_packet(&mut packet, &mut carry);
        while payload_len(&packet) < CHUNK_BYTES && carry.is_empty() && !ended {
            match chunks.next().now_or_never() {
                Some(Some(Ok(next))) => {
                    carry = next;
                    fill_packet(&mut packet, &mut carry);
                }
                Some(Some(Err(e))) => {
                    failure = Some(e.to_string());
                    ended = true;
                }
                Some(None) => ended = true,
                None => break,
            }
        }
        if payload_len(&packet) == 0 {
            if ended {
                return failure.map_or(Ok(()), Err);
            }
            match chunks.next().await {
                Some(Ok(next)) => carry = next,
                Some(Err(e)) => return Err(e.to_string()),
                None => return Ok(()),
            }
            continue;
        }
        while !control.try_reserve(payload_len(&packet))? {
            let can_absorb = payload_len(&packet) < CHUNK_BYTES && carry.is_empty() && !ended;
            if can_absorb {
                tokio::select! {
                    changed = control.credit_changed() => changed?,
                    next = chunks.next() => match next {
                        Some(Ok(next)) => {
                            carry = next;
                            fill_packet(&mut packet, &mut carry);
                        }
                        Some(Err(e)) => {
                            failure = Some(e.to_string());
                            ended = true;
                        }
                        None => ended = true,
                    },
                }
            } else {
                control.credit_changed().await?;
            }
        }
        send(std::mem::replace(&mut packet, new_packet(1, 0)))?;
        if ended && carry.is_empty() {
            return failure.map_or(Ok(()), Err);
        }
    }
}

#[tauri::command]
pub async fn ai_http_cancel(
    window: WebviewWindow,
    state: State<'_, AiStreamState>,
    request_id: String,
) -> Result<(), String> {
    state.cancel(window.label(), &request_id);
    Ok(())
}

/// Async so the acknowledgment never rides the main thread, which is where
/// Tauri runs a plain command.
#[tauri::command]
pub async fn ai_http_ack(
    window: WebviewWindow,
    state: State<'_, AiStreamState>,
    request_id: String,
    bytes: u64,
) -> Result<(), String> {
    state.acknowledge(window.label(), &request_id, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn metadata_ips_classified_as_blocked() {
        // AWS / Google / Azure all share the IPv4 169.254.169.254 link-local.
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))),
            IpKind::BlockedMetadata
        );
        // AWS IPv6 metadata
        assert_eq!(
            ip_kind("fd00:ec2::254".parse().unwrap()),
            IpKind::BlockedMetadata
        );
        // Any link-local IPv4 (169.254/16) — same network range, still blocked.
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))),
            IpKind::BlockedMetadata
        );
        // IPv6 link-local fe80::/10
        assert_eq!(ip_kind("fe80::1".parse().unwrap()), IpKind::BlockedMetadata);
    }

    #[test]
    fn private_ips_classified_correctly() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))),
            IpKind::Private
        );
        // CGNAT 100.64/10
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))),
            IpKind::Private
        );
    }

    #[test]
    fn loopback_classified_as_loopback() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
            IpKind::Loopback
        );
        assert_eq!(ip_kind("::1".parse().unwrap()), IpKind::Loopback);
    }

    #[test]
    fn public_ips_classified_as_public() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))),
            IpKind::Public
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))),
            IpKind::Public
        );
    }

    #[test]
    fn validate_url_blocks_userinfo_and_metadata_hostnames() {
        // URLs with userinfo can confuse browsers / leak creds in redirects.
        assert!(validate_url("http://user:pass@example.com/", true).is_err());
        // Cloud metadata-by-name.
        assert!(validate_url("http://metadata.google.internal/", true).is_err());
        assert!(validate_url("http://metadata/", true).is_err());
        assert!(validate_url("http://metadata.azure.com/", true).is_err());
    }

    #[test]
    fn validate_url_rejects_non_http_schemes() {
        assert!(validate_url("ftp://example.com/", true).is_err());
        assert!(validate_url("file:///etc/passwd", true).is_err());
        assert!(validate_url("javascript:alert(1)", true).is_err());
    }

    #[test]
    fn sanitize_headers_blocks_crlf_injection() {
        let mut h = HashMap::new();
        h.insert("X-Foo".to_string(), "bar\r\nX-Evil: yes".to_string());
        assert!(sanitize_headers(Some(h)).is_err());
    }

    #[test]
    fn sanitize_headers_blocks_hop_by_hop_headers() {
        for hop in [
            "host",
            "content-length",
            "connection",
            "proxy-authorization",
        ] {
            let mut h = HashMap::new();
            h.insert(hop.to_string(), "value".to_string());
            assert!(
                sanitize_headers(Some(h)).is_err(),
                "expected {hop} to be rejected"
            );
        }
    }

    #[test]
    fn special_ipv4_ranges_do_not_classify_as_public() {
        assert_eq!(ip_kind(IpAddr::V4(Ipv4Addr::UNSPECIFIED)), IpKind::Loopback);
        assert_eq!(ip_kind(IpAddr::V4(Ipv4Addr::BROADCAST)), IpKind::Loopback);
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(224, 0, 0, 1))),
            IpKind::Loopback
        );
    }

    #[test]
    fn private_range_boundaries_hold_on_ipv4() {
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(172, 31, 255, 255))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(172, 32, 0, 1))),
            IpKind::Public
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(100, 127, 255, 255))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(100, 128, 0, 1))),
            IpKind::Public
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(198, 19, 255, 255))),
            IpKind::Private
        );
        assert_eq!(
            ip_kind(IpAddr::V4(Ipv4Addr::new(198, 20, 0, 1))),
            IpKind::Public
        );
    }

    #[test]
    fn ipv6_unique_local_and_multicast_are_not_public() {
        assert_eq!(ip_kind("fd12:3456::1".parse().unwrap()), IpKind::Private);
        assert_eq!(ip_kind("fc00::1".parse().unwrap()), IpKind::Private);
        assert_eq!(ip_kind("ff02::1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(ip_kind("::".parse().unwrap()), IpKind::Loopback);
        assert_eq!(ip_kind("2606:4700::1111".parse().unwrap()), IpKind::Public);
    }

    #[test]
    fn blocked_host_name_match_is_case_insensitive_and_exact() {
        assert!(is_blocked_host_name("METADATA.google.internal"));
        assert!(!is_blocked_host_name("metadata.evil.internal"));
        assert!(!is_blocked_host_name("my-metadata"));
    }

    #[test]
    fn validate_url_requires_a_host() {
        // A URL that parses but carries no host must not slip through.
        assert!(validate_url("http://", true).is_err());
    }

    #[test]
    fn request_bodies_become_shared_bytes_and_empty_means_no_body() {
        let out = request_body(&InvokeBody::Raw(b"{\"a\":1}".to_vec()))
            .unwrap()
            .unwrap();
        assert_eq!(&out[..], b"{\"a\":1}");
        assert_eq!(request_body(&InvokeBody::Raw(vec![])), Ok(None));
        let fallback = request_body(&InvokeBody::Json(serde_json::json!([104, 105]))).unwrap();
        assert_eq!(fallback.as_deref(), Some(&b"hi"[..]));
        assert_eq!(
            request_body(&InvokeBody::Json(serde_json::json!(null))),
            Ok(None)
        );
        assert!(request_body(&InvokeBody::Json(serde_json::json!("nope"))).is_err());
    }

    #[test]
    fn ipv6_literal_hosts_resolve_without_dns() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let (kind, ips) = rt.block_on(resolve_and_classify("[::1]")).unwrap();
        assert_eq!(kind, IpKind::Loopback);
        assert_eq!(ips, vec!["::1".parse::<IpAddr>().unwrap()]);
        let (kind, _) = rt
            .block_on(resolve_and_classify("[2606:4700::1111]"))
            .unwrap();
        assert_eq!(kind, IpKind::Public);
    }

    #[test]
    fn embedded_ipv4_literals_cannot_smuggle_internal_hosts_past_the_guard() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        for (host, kind) in [
            ("[::ffff:127.0.0.1]", IpKind::Loopback),
            ("[::ffff:169.254.169.254]", IpKind::BlockedMetadata),
            ("[::ffff:10.0.0.1]", IpKind::Private),
            ("[64:ff9b::7f00:1]", IpKind::Loopback),
            ("[2002:7f00:1::]", IpKind::Loopback),
            ("[::127.0.0.1]", IpKind::Loopback),
        ] {
            let (found, _) = rt.block_on(resolve_and_classify(host)).unwrap();
            assert_eq!(found, kind, "{host}");
            let refused = rt.block_on(classify_and_collect_safe_ips(host, false));
            assert!(refused.is_err(), "{host} must need explicit opt-in");
            let opted_in = rt.block_on(classify_and_collect_safe_ips(host, true));
            assert_eq!(
                opted_in.is_err(),
                kind == IpKind::BlockedMetadata,
                "{host}: metadata stays blocked even with opt-in"
            );
        }
        let (kind, _) = rt
            .block_on(resolve_and_classify("[::ffff:8.8.8.8]"))
            .unwrap();
        assert_eq!(kind, IpKind::Public);
    }

    mod flow {
        use super::*;
        use crate::modules::net::stream::{AiStreamState, CHUNK_BYTES};
        use std::sync::mpsc;

        type Chunks = std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<Bytes, String>>>>;

        fn ready(parts: Vec<Result<Bytes, String>>) -> Chunks {
            Box::pin(futures_util::stream::iter(parts))
        }

        fn run_pump(
            chunks: Chunks,
        ) -> (
            tokio::task::JoinHandle<Result<(), String>>,
            mpsc::Receiver<Vec<u8>>,
            AiStreamState,
        ) {
            let state = AiStreamState::default();
            let (lease, _) = state.start("w", "r").unwrap();
            let (tx, rx) = mpsc::channel();
            let task = tokio::task::spawn_local(async move {
                let result = pump(chunks, &lease.control.clone(), move |packet| {
                    tx.send(packet).map_err(|e| e.to_string())
                })
                .await;
                drop(lease);
                result
            });
            (task, rx, state)
        }

        async fn local<F: std::future::Future>(future: F) -> F::Output {
            tokio::task::LocalSet::new().run_until(future).await
        }

        #[tokio::test]
        async fn many_small_ready_chunks_become_one_packet() {
            local(async {
                let parts = (0..50)
                    .map(|_| Ok(Bytes::from(vec![b'x'; 100])))
                    .collect::<Vec<_>>();
                let (task, rx, _state) = run_pump(ready(parts));
                task.await.unwrap().unwrap();
                let packets: Vec<_> = rx.try_iter().collect();
                assert_eq!(packets.len(), 1);
                assert_eq!(packets[0][0], 1);
                assert_eq!(packets[0].len(), 1 + 5000);
            })
            .await;
        }

        #[tokio::test]
        async fn bodies_larger_than_the_window_flow_as_acknowledgments_arrive() {
            local(async {
                let total = 300 * 1024;
                let (task, rx, state) = run_pump(ready(vec![Ok(Bytes::from(vec![9u8; total]))]));
                let mut received = 0usize;
                let mut largest = 0usize;
                while received < total {
                    tokio::task::yield_now().await;
                    while let Ok(packet) = rx.try_recv() {
                        largest = largest.max(packet.len() - 1);
                        received += packet.len() - 1;
                        state.acknowledge("w", "r", received as u64).unwrap();
                    }
                }
                task.await.unwrap().unwrap();
                assert_eq!(received, total);
                assert_eq!(largest, CHUNK_BYTES);
            })
            .await;
        }

        #[tokio::test]
        async fn a_full_window_stalls_the_pump_until_the_consumer_acknowledges() {
            local(async {
                let (task, rx, state) =
                    run_pump(ready(vec![Ok(Bytes::from(vec![1u8; 192 * 1024]))]));
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                let first: Vec<_> = rx.try_iter().collect();
                assert_eq!(first.len(), 2, "only two 64 KiB packets fit in the window");
                assert!(!task.is_finished());
                state.acknowledge("w", "r", (64 * 1024) as u64).unwrap();
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                assert_eq!(rx.try_iter().count(), 1);
                task.await.unwrap().unwrap();
            })
            .await;
        }

        #[tokio::test]
        async fn network_data_arriving_while_blocked_is_coalesced_into_the_next_packet() {
            local(async {
                let (net_tx, net_rx) = tokio::sync::mpsc::unbounded_channel::<Bytes>();
                let chunks: Chunks =
                    Box::pin(futures_util::stream::unfold(net_rx, |mut rx| async move {
                        rx.recv().await.map(|b| (Ok::<_, String>(b), rx))
                    }));
                let (task, rx, state) = run_pump(chunks);
                net_tx.send(Bytes::from(vec![0u8; 128 * 1024])).unwrap();
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                assert_eq!(rx.try_iter().count(), 2);
                for _ in 0..40 {
                    net_tx.send(Bytes::from_static(b"tiny")).unwrap();
                    tokio::task::yield_now().await;
                }
                assert_eq!(rx.try_iter().count(), 0, "window still full");
                state.acknowledge("w", "r", (64 * 1024) as u64).unwrap();
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                let next: Vec<_> = rx.try_iter().collect();
                assert_eq!(next.len(), 1);
                assert_eq!(next[0].len(), 1 + 160, "forty tiny chunks, one packet");
                drop(net_tx);
                state.acknowledge("w", "r", (128 * 1024) as u64).unwrap();
                task.await.unwrap().unwrap();
            })
            .await;
        }

        #[tokio::test]
        async fn a_network_error_still_delivers_what_arrived_before_it() {
            local(async {
                let (task, rx, _state) = run_pump(ready(vec![
                    Ok(Bytes::from_static(b"data: [DONE]\n\n")),
                    Err("connection reset".into()),
                ]));
                assert_eq!(task.await.unwrap(), Err("connection reset".to_string()));
                let packets: Vec<_> = rx.try_iter().collect();
                assert_eq!(packets.len(), 1);
                assert_eq!(&packets[0][1..], b"data: [DONE]\n\n");
            })
            .await;
        }
    }
}
