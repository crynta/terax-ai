export class SessionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionProtocolError";
    this.code = code;
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
