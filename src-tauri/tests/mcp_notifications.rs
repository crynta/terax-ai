use serde_json::{json, Value};

fn handle_request(request: Value) -> Option<Value> {
    let id_val = request.get("id")?;
    let id = id_val.clone();
    let method = request.get("method").and_then(|m| m.as_str()).unwrap_or("");

    let result = match method {
        "ping" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {}
        }),
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": format!("Method not found: {method}") }
        }),
    };
    Some(result)
}

#[test]
fn notification_returns_none() {
    let notification = json!({
        "jsonrpc": "2.0",
        "method": "initialized"
    });
    assert!(handle_request(notification).is_none());
}

#[test]
fn request_with_id_returns_response() {
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "ping"
    });
    let response = handle_request(request).unwrap();
    assert_eq!(response["id"], 1);
    assert_eq!(response["result"], json!({}));
}

#[test]
fn request_with_null_id_returns_response() {
    let request = json!({
        "jsonrpc": "2.0",
        "id": null,
        "method": "ping"
    });
    let response = handle_request(request).unwrap();
    assert!(response["id"].is_null());
}

#[test]
fn unknown_method_returns_error() {
    let request = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "nonexistent"
    });
    let response = handle_request(request).unwrap();
    assert!(response.get("error").is_some());
    assert_eq!(response["error"]["code"], -32601);
}

#[test]
fn notification_with_null_id_returns_none() {
    let notification = json!({
        "jsonrpc": "2.0",
        "method": "cancelled"
    });
    assert!(handle_request(notification).is_none());
}
