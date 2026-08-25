use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const METHOD_PING: &str = "ping";
pub const METHOD_CAPABILITIES: &str = "capabilities";
pub const METHOD_IDENTIFY: &str = "identify";
pub const METHOD_OPEN: &str = "open";
pub const SERVER_RESPONSE_ID: &str = "server";
pub const METHODS: &[&str] = &[
    METHOD_PING,
    METHOD_CAPABILITIES,
    METHOD_IDENTIFY,
    METHOD_OPEN,
];

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct CallerContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<u32>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlRequest {
    pub protocol: u16,
    pub id: String,
    pub token: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlError {
    pub code: String,
    pub message: String,
}

impl ControlError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ControlResponse {
    pub protocol: u16,
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

impl ControlResponse {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(
        id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: false,
            result: None,
            error: Some(ControlError::new(code, message)),
        }
    }
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
pub struct ControlDescriptor {
    pub protocol: u16,
    pub address: String,
    pub token: String,
    pub pid: u32,
    pub app_version: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendRequest {
    pub id: String,
    pub method: String,
    pub params: Value,
    pub caller: CallerContext,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct FrontendResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ControlError>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct OpenParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(default = "default_focus")]
    pub focus: bool,
}

fn default_focus() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips_without_caller_context() {
        let raw = json!({
            "protocol": PROTOCOL_VERSION,
            "id": "42",
            "token": "secret",
            "method": METHOD_PING,
            "params": {}
        });
        let request: ControlRequest = serde_json::from_value(raw).expect("deserialize request");
        assert_eq!(request.caller, CallerContext::default());
        assert_eq!(request.method, METHOD_PING);
    }

    #[test]
    fn response_shapes_are_unambiguous() {
        let success = ControlResponse::success("1", json!({ "pong": true }));
        assert!(success.ok);
        assert!(success.result.is_some());
        assert!(success.error.is_none());

        let failure = ControlResponse::failure("2", "invalid_request", "bad request");
        assert!(!failure.ok);
        assert!(failure.result.is_none());
        assert_eq!(failure.error.expect("error").code, "invalid_request");
    }

    #[test]
    fn open_defaults_to_focusing_the_target() {
        let params: OpenParams =
            serde_json::from_value(json!({ "path": "/tmp/a" })).expect("deserialize open params");
        assert!(params.focus);
    }

    #[test]
    fn protocol_version_is_locked_at_one() {
        assert_eq!(PROTOCOL_VERSION, 1);
        assert_eq!(MAX_MESSAGE_BYTES, 64 * 1024);
    }

    #[test]
    fn methods_catalog_matches_the_documented_constants() {
        assert_eq!(
            METHODS,
            &[
                METHOD_PING,
                METHOD_CAPABILITIES,
                METHOD_IDENTIFY,
                METHOD_OPEN
            ]
        );
    }

    #[test]
    fn open_params_omit_absent_optionals_from_the_wire() {
        let minimal = OpenParams {
            path: "/tmp/a".into(),
            line: None,
            column: None,
            focus: true,
        };
        assert_eq!(
            serde_json::to_value(&minimal).unwrap(),
            json!({ "path": "/tmp/a", "focus": true })
        );

        let located = OpenParams {
            path: "/tmp/a".into(),
            line: Some(12),
            column: Some(34),
            focus: false,
        };
        assert_eq!(
            serde_json::to_value(&located).unwrap(),
            json!({
                "path": "/tmp/a",
                "line": 12,
                "column": 34,
                "focus": false,
            })
        );
    }

    #[test]
    fn success_responses_omit_null_fields_and_failures_omit_results() {
        let success = ControlResponse::success("7", json!({ "version": "0.8.6" }));
        let value = serde_json::to_value(&success).unwrap();
        assert!(value.get("result").is_some());
        assert!(value.get("error").is_none());

        let failure = ControlResponse::failure("8", "unauthorized", "bad token");
        let value = serde_json::to_value(&failure).unwrap();
        assert!(value.get("result").is_none());
        assert!(value.get("error").is_some());
    }

    #[test]
    fn caller_context_round_trips_with_and_without_a_pane() {
        let with_pane = CallerContext {
            pane_id: Some(3),
        };
        let value = serde_json::to_value(&with_pane).unwrap();
        assert_eq!(value, json!({ "pane_id": 3 }));
        let back: CallerContext = serde_json::from_value(value).unwrap();
        assert_eq!(back, with_pane);

        let value = serde_json::to_value(CallerContext::default()).unwrap();
        assert_eq!(value, json!({}));
    }

    #[test]
    fn frontend_exchange_shapes_survive_a_round_trip() {
        let request = FrontendRequest {
            id: "9".into(),
            method: METHOD_OPEN.into(),
            params: json!({ "path": "/tmp/a", "line": 1 }),
            caller: CallerContext { pane_id: Some(5) },
        };
        let value = serde_json::to_value(&request).unwrap();
        let back: FrontendRequest = serde_json::from_value(value).unwrap();
        assert_eq!(back, request);

        let response = FrontendResponse {
            ok: true,
            result: Some(json!({ "opened": true })),
            error: None,
        };
        let value = serde_json::to_value(&response).unwrap();
        assert!(value.get("error").is_none());
        let back: FrontendResponse = serde_json::from_value(value).unwrap();
        assert_eq!(back, response);
    }

    #[test]
    fn descriptor_carries_the_discovery_fields() {
        let descriptor = ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: "127.0.0.1:54321".into(),
            token: "tok".into(),
            pid: 4242,
            app_version: "0.8.6".into(),
        };
        let back: ControlDescriptor =
            serde_json::from_str(&serde_json::to_string(&descriptor).unwrap()).unwrap();
        assert_eq!(back.protocol, 1);
        assert_eq!(back.address, "127.0.0.1:54321");
        assert_eq!(back.token, "tok");
        assert_eq!(back.pid, 4242);
        assert_eq!(back.app_version, "0.8.6");
    }
}
