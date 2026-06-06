const ERROR_METADATA_BY_CODE = new Map([
  [
    -32602,
    {
      code: "PI_INVALID_PARAMS",
      category: "validation",
      retryable: false,
      remediation: "Check the Pi request fields and try again.",
    },
  ],
  [
    -32004,
    {
      code: "PI_SESSION_NOT_FOUND",
      category: "not_found",
      retryable: false,
      remediation: "Create or select an existing Pi session.",
    },
  ],
  [
    -32005,
    {
      code: "PI_SESSION_STOPPED",
      category: "state",
      retryable: false,
      remediation:
        "Create a new Pi session or select a session that is not stopped.",
    },
  ],
  [
    -32006,
    {
      code: "PI_RESOURCE_LIMIT",
      category: "resource_limit",
      retryable: false,
      remediation:
        "Close older Pi sessions or shorten the prompt, then try again.",
    },
  ],
  [
    -32007,
    {
      code: "PI_SESSION_BUSY",
      category: "state",
      retryable: true,
      remediation:
        "Wait for the running Pi response to finish, or stop it before retrying.",
    },
  ],
  [
    -32008,
    {
      code: "PI_APPROVAL_NOT_FOUND",
      category: "not_found",
      retryable: false,
      remediation:
        "The approval request expired or was already answered. Send a new prompt if the tool still needs to run.",
    },
  ],
  [
    -32009,
    {
      code: "PI_SESSION_FILE_NOT_FOUND",
      category: "not_found",
      retryable: false,
      remediation:
        "The saved Pi SDK session file is missing or no longer readable. Continue in a new Pi session.",
    },
  ],
]);

export class SessionProtocolError extends Error {
  constructor(code, message, data = undefined) {
    super(message);
    this.name = "SessionProtocolError";
    this.code = code;
    this.data = data ?? ERROR_METADATA_BY_CODE.get(code);
  }
}

function rawErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function friendlySessionErrorMessage(error) {
  const message = rawErrorMessage(error);
  if (/api[ _-]?key|unauthorized|authentication/i.test(message)) {
    return "Provider authentication failed. Open Settings > Models and check the selected Pi provider key.";
  }
  if (/model.*(not available|not found|unknown)|unknown model/i.test(message)) {
    return "Selected Pi model is not available. Open Settings > Models and choose another model.";
  }
  return message;
}
