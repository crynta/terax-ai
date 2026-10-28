//! Raw IPC request bodies.
//!
//! Commands that move large payloads (AI request bodies, conversations) take a
//! `tauri::ipc::Request` so the bytes never pass through a JSON string. macOS
//! delivers an `application/octet-stream` body as raw bytes. When the custom
//! protocol IPC is unavailable on a platform (blocked by CSP or a webview
//! policy) Tauri falls back to `postMessage`, where a `Uint8Array` arrives as
//! a parsed JSON array of numbers. Both are accepted so such a platform keeps
//! working instead of failing every call.

use std::borrow::Cow;

use tauri::ipc::InvokeBody;

/// The fallback holds every byte as a parsed JSON number (about 24 bytes of
/// memory each), so it is held to a far smaller ceiling than the raw path.
pub const JSON_FALLBACK_MAX_BYTES: usize = 16 * 1024 * 1024;

/// Raw bytes are borrowed from the IPC message; only the fallback allocates.
pub fn bytes_of(
    body: &InvokeBody,
    raw_max: usize,
    json_max: usize,
) -> Result<Cow<'_, [u8]>, String> {
    match body {
        InvokeBody::Raw(bytes) => {
            if bytes.len() > raw_max {
                return Err(format!(
                    "request body exceeds {} MiB",
                    raw_max / (1024 * 1024)
                ));
            }
            Ok(Cow::Borrowed(bytes))
        }
        InvokeBody::Json(serde_json::Value::Null) => Ok(Cow::Borrowed(&[])),
        InvokeBody::Json(serde_json::Value::Object(map)) if map.is_empty() => {
            Ok(Cow::Borrowed(&[]))
        }
        InvokeBody::Json(serde_json::Value::Array(items)) => {
            if items.len() > json_max {
                return Err("request body is too large for the fallback IPC path".into());
            }
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let byte = item
                    .as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or("request body must be bytes")?;
                out.push(byte);
            }
            Ok(Cow::Owned(out))
        }
        InvokeBody::Json(_) => Err("expected a binary request body".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn raw_bodies_are_borrowed_not_copied() {
        let body = InvokeBody::Raw(b"{\"a\":1}".to_vec());
        let out = bytes_of(&body, 64, 64).unwrap();
        assert!(matches!(out, Cow::Borrowed(_)));
        assert_eq!(&*out, b"{\"a\":1}");
        assert!(bytes_of(&InvokeBody::Raw(vec![0; 65]), 64, 64).is_err());
        assert!(bytes_of(&InvokeBody::Raw(vec![]), 64, 64)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn platforms_that_deliver_json_instead_of_raw_bytes_are_accepted() {
        let body = InvokeBody::Json(json!([104, 105, 0, 255]));
        let out = bytes_of(&body, 64, 64).unwrap();
        assert_eq!(&*out, &[104, 105, 0, 255]);
        for empty in [json!([]), json!(null), json!({})] {
            assert!(bytes_of(&InvokeBody::Json(empty), 64, 64)
                .unwrap()
                .is_empty());
        }
    }

    #[test]
    fn json_bodies_that_are_not_byte_arrays_are_rejected() {
        for bad in [
            json!([256]),
            json!([-1]),
            json!([1.5]),
            json!(["a"]),
            json!("text"),
            json!({"k": 1}),
            json!(7),
        ] {
            assert!(
                bytes_of(&InvokeBody::Json(bad.clone()), 64, 64).is_err(),
                "{bad}"
            );
        }
        assert!(bytes_of(&InvokeBody::Json(json!([1, 2, 3])), 64, 2).is_err());
    }
}
