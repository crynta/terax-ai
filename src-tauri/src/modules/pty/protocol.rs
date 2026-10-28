//! The `terax-pty` custom URI scheme: the HTTP-shaped edge of the PTY hub.
//!
//! `POST /poll` is held open until output is due; `POST /ack` applies
//! acknowledgements and returns at once. Both carry the stream token from
//! `pty_stream_open` in their binary body (see `wire`).
//!
//! Any frame in the webview can reach this scheme, including a preview iframe
//! showing an arbitrary web page, so a request is admitted (see `gate`) before
//! it may touch the hub: its `Origin` must be the application's own, its body
//! must be of legal size and framing, and its token must be the live one for
//! the requesting webview. Only the page's own frame can invoke the command
//! that issues the token. Responses name the allowed origin, never `*`.
//!
//! Frontend URL (see `convertFileSrc`): `terax-pty://localhost/poll` on
//! macOS and Linux, `http://terax-pty.localhost/poll` on Windows.

use std::sync::Arc;

use tauri::http::{self, header, HeaderValue, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::gate::{admit, Admission, AllowedOrigins, Incoming};
use super::hub::{Command, Hub, Reply};
use super::PtyState;

fn http_response(status: u16, body: Vec<u8>, origin: Option<&str>) -> http::Response<Vec<u8>> {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    if status == StatusCode::NO_CONTENT {
        // The hub never answers 204; it is the CORS preflight verdict.
        return preflight_response(origin);
    }
    let content_type = if status == StatusCode::OK {
        "application/octet-stream"
    } else {
        "text/plain"
    };
    cors(
        http::Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, content_type)
            // Output is one-shot: never cached, never sniffed.
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        origin,
    )
    .body(body)
    .expect("static response headers are valid")
}

fn preflight_response(origin: Option<&str>) -> http::Response<Vec<u8>> {
    let builder = http::Response::builder().status(StatusCode::NO_CONTENT);
    let builder = if origin.is_some() {
        builder
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "POST, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .header(header::ACCESS_CONTROL_MAX_AGE, "600")
    } else {
        builder
    };
    cors(builder, origin)
        .body(Vec::new())
        .expect("static response headers are valid")
}

/// Names the allowed origin (never `*`) and says the answer depends on it. A
/// refused request names none, so a browser will not hand its answer to a page.
fn cors(builder: http::response::Builder, origin: Option<&str>) -> http::response::Builder {
    let builder = builder.header(header::VARY, "Origin");
    match origin.map(HeaderValue::from_str) {
        Some(Ok(value)) => builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, value),
        _ => builder,
    }
}

struct TauriReply {
    responder: UriSchemeResponder,
    origin: Option<Arc<str>>,
}

impl Reply for TauriReply {
    fn send(self: Box<Self>, status: u16, body: Vec<u8>) {
        self.responder
            .respond(http_response(status, body, self.origin.as_deref()));
    }
}

/// Registered with `register_asynchronous_uri_scheme_protocol("terax-pty", ..)`.
/// Runs on the webview's main thread, so it only admits and enqueues; the
/// hub thread does the work and answers through the responder.
pub fn stream_protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle();
    let Some(state) = app.try_state::<PtyState>() else {
        responder.respond(http_response(
            503,
            b"PTY transport unavailable".to_vec(),
            None,
        ));
        return;
    };
    let origins = state.origins.get_or_init(|| {
        AllowedOrigins::for_app(
            app.config().build.dev_url.as_ref(),
            tauri::is_dev(),
            cfg!(windows),
        )
    });
    dispatch(
        &state.hub,
        origins,
        &Incoming {
            label: ctx.webview_label(),
            method: request.method(),
            path: request.uri().path(),
            origin: request
                .headers()
                .get(header::ORIGIN)
                .map(HeaderValue::as_bytes),
            body: request.body(),
        },
        |origin| Box::new(TauriReply { responder, origin }),
    );
}

/// Answers refusals here and hands only admitted requests to the hub, so a
/// request that is not allowed never wakes its thread.
fn dispatch(
    hub: &Hub,
    origins: &AllowedOrigins,
    incoming: &Incoming<'_>,
    reply: impl FnOnce(Option<Arc<str>>) -> Box<dyn Reply>,
) {
    match admit(origins, hub.tokens(), incoming) {
        Admission::Preflight { origin } => {
            reply(Some(origin)).send(StatusCode::NO_CONTENT.as_u16(), Vec::new());
        }
        Admission::Reject {
            status,
            message,
            origin,
        } => reply(origin).send(status.as_u16(), message.as_bytes().to_vec()),
        Admission::Forward {
            endpoint,
            request,
            origin,
        } => hub.submit(Command::Request {
            label: Arc::from(incoming.label),
            endpoint,
            request,
            reply: reply(Some(origin)),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::pty::wire::{encode_request, Ack, MAX_REQUEST_LEN};
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::http::Method;

    struct Capture {
        tx: mpsc::Sender<(u16, Vec<u8>)>,
    }

    impl Reply for Capture {
        fn send(self: Box<Self>, status: u16, body: Vec<u8>) {
            let _ = self.tx.send((status, body));
        }
    }

    const APP: &[u8] = b"tauri://localhost";

    fn origins() -> AllowedOrigins {
        AllowedOrigins::for_app(None, false, false)
    }

    fn call_as(
        hub: &Hub,
        label: &str,
        method: Method,
        path: &str,
        origin: Option<&[u8]>,
        body: &[u8],
    ) -> (u16, Vec<u8>) {
        let (tx, rx) = mpsc::channel();
        dispatch(
            hub,
            &origins(),
            &Incoming {
                label,
                method: &method,
                path,
                origin,
                body,
            },
            |_| Box::new(Capture { tx }),
        );
        rx.recv_timeout(Duration::from_secs(5)).unwrap()
    }

    fn call(hub: &Hub, method: Method, path: &str, body: &[u8]) -> (u16, Vec<u8>) {
        call_as(hub, "main", method, path, Some(APP), body)
    }

    fn open_stream(hub: &Hub, label: &str) -> u64 {
        let (tx, rx) = mpsc::channel();
        hub.submit(Command::OpenStream {
            label: Arc::from(label),
            reply: Box::new(move |token| tx.send(token).unwrap()),
        });
        rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap()
    }

    #[test]
    fn responses_are_uncacheable_binary_and_name_only_the_allowed_origin() {
        let ok = http_response(200, vec![1, 2, 3], Some("tauri://localhost"));
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(
            ok.headers()[header::CONTENT_TYPE],
            "application/octet-stream"
        );
        assert_eq!(ok.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            ok.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "tauri://localhost"
        );
        assert_eq!(ok.headers()[header::VARY], "Origin");
        assert_eq!(ok.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let refused = http_response(403, Vec::new(), None);
        assert_eq!(refused.headers()[header::CONTENT_TYPE], "text/plain");
        assert!(refused
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert_eq!(refused.headers()[header::VARY], "Origin");
        assert_eq!(http_response(9999, Vec::new(), None).status(), 500);
        let preflight = http_response(204, Vec::new(), Some("tauri://localhost"));
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            preflight.headers()[header::ACCESS_CONTROL_ALLOW_METHODS],
            "POST, OPTIONS"
        );
        assert_eq!(
            preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "tauri://localhost"
        );
        let denied = http_response(204, Vec::new(), None);
        assert!(denied
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert!(denied
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_METHODS)
            .is_none());
        for response in [&ok, &refused, &preflight, &denied] {
            assert_ne!(
                response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
                Some(&HeaderValue::from_static("*"))
            );
        }
    }

    #[test]
    fn malformed_bodies_are_rejected_at_the_boundary_without_reaching_the_hub() {
        let hub = Hub::new();
        let good = encode_request(7, &[Ack { id: 1, bytes: 2 }]);
        for body in [
            Vec::new(),
            good[..11].to_vec(),
            good[..good.len() - 1].to_vec(),
            [good.clone(), vec![0]].concat(),
            vec![0xff; 4096],
        ] {
            let (status, message) = call(&hub, Method::POST, "/poll", &body);
            assert!(status == 400 || status == 413, "{status} {body:?}");
            assert!(!message.is_empty());
        }
        assert_eq!(call(&hub, Method::GET, "/poll", &good).0, 405);
        assert_eq!(call(&hub, Method::POST, "/other", &good).0, 404);
        assert_eq!(call(&hub, Method::OPTIONS, "/poll", &[]).0, 204);
        assert!(!hub.started(), "refusals must not start or wake the hub");
    }

    #[test]
    fn refused_requests_never_wake_the_hub() {
        let hub = Hub::new();
        let token = open_stream(&hub, "main");
        let wakeups = || hub.diagnostics().wakeups;
        let settled = {
            std::thread::sleep(Duration::from_millis(100));
            wakeups()
        };
        let valid = encode_request(token, &[Ack { id: 1, bytes: 0 }]);
        let wrong_token = encode_request(token ^ 1, &[Ack { id: 1, bytes: 0 }]);
        let too_long = vec![0u8; MAX_REQUEST_LEN + 1];
        type Case<'a> = (&'a str, Option<&'a [u8]>, &'a [u8], u16);
        let cases: [Case<'_>; 6] = [
            ("main", Some(b"https://evil.example"), &valid, 403),
            ("main", Some(b"null"), &valid, 403),
            ("main", Some(APP), &wrong_token, 403),
            ("settings", Some(APP), &valid, 403),
            ("main", Some(APP), &too_long, 413),
            ("main", Some(APP), &[1, 2, 3], 400),
        ];
        for round in 0..50 {
            for (label, origin, body, expected) in cases {
                let path = if round % 2 == 0 { "/poll" } else { "/ack" };
                let (status, _) = call_as(&hub, label, Method::POST, path, origin, body);
                assert_eq!(status, expected, "{label} {origin:?}");
            }
        }
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(wakeups(), settled, "refusals woke the hub thread");
        let diagnostics = hub.diagnostics();
        assert_eq!(diagnostics.rejected_requests, 0);
        assert_eq!(diagnostics.polls + diagnostics.ack_requests, 0);
        // The same hub still serves the legitimate page.
        assert_eq!(call(&hub, Method::POST, "/ack", &valid), (200, Vec::new()));
        assert_eq!(hub.diagnostics().ack_requests, 1);
    }

    #[test]
    fn a_well_formed_request_without_a_valid_token_is_forbidden() {
        let hub = Hub::new();
        let body = encode_request(0xABCD, &[Ack { id: 99, bytes: 5 }]);
        assert_eq!(call(&hub, Method::POST, "/ack", &body).0, 403);
        assert_eq!(call(&hub, Method::POST, "/poll", &body).0, 403);
        assert!(!hub.started());
    }

    #[test]
    fn a_valid_token_authorizes_ack_requests_and_unknown_ids_are_ignored() {
        let hub = Hub::new();
        let token = open_stream(&hub, "main");
        let body = encode_request(token, &[Ack { id: 99, bytes: 5 }]);
        assert_eq!(call(&hub, Method::POST, "/ack", &body), (200, Vec::new()));
        // Another webview cannot use this token.
        let other = call_as(&hub, "settings", Method::POST, "/ack", Some(APP), &body);
        assert_eq!(other.0, 403);
        // Without an Origin header the token alone authorizes the request.
        let bare = call_as(&hub, "main", Method::POST, "/ack", None, &body);
        assert_eq!(bare, (200, Vec::new()));
    }

    #[test]
    fn a_revoked_token_is_refused_at_the_gate() {
        let hub = Hub::new();
        let token = open_stream(&hub, "main");
        let body = encode_request(token, &[]);
        assert_eq!(call(&hub, Method::POST, "/ack", &body).0, 200);
        hub.submit(Command::ResetWebview {
            label: Arc::from("main"),
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while hub.tokens().authorizes("main", token) {
            assert!(std::time::Instant::now() < deadline, "token never revoked");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(call(&hub, Method::POST, "/ack", &body).0, 403);
    }
}
