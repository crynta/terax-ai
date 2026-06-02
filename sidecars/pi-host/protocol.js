export const HOST_VERSION = "0.1.0";

const ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
};

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function successResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function status() {
  return {
    phase: "ready",
    detail: "Pi host stub",
    hostVersion: HOST_VERSION,
    piSdkLoaded: false,
  };
}

function isRequest(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.jsonrpc === "2.0" &&
    Number.isInteger(value.id) &&
    typeof value.method === "string"
  );
}

export function handleJsonRpcLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return {
      response: errorResponse(null, ERROR_CODES.parseError, "Parse error"),
      shutdown: false,
    };
  }

  if (!isRequest(request)) {
    return {
      response: errorResponse(
        request?.id ?? null,
        ERROR_CODES.invalidRequest,
        "Invalid request",
      ),
      shutdown: false,
    };
  }

  switch (request.method) {
    case "ping":
      return {
        response: successResponse(request.id, { pong: true }),
        shutdown: false,
      };
    case "status":
      return {
        response: successResponse(request.id, status()),
        shutdown: false,
      };
    case "shutdown":
      return {
        response: successResponse(request.id, { ok: true }),
        shutdown: true,
      };
    default:
      return {
        response: errorResponse(
          request.id,
          ERROR_CODES.methodNotFound,
          "Method not found",
        ),
        shutdown: false,
      };
  }
}
